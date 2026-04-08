"use client";

import { useRef, useEffect, useCallback, useState, useMemo } from "react";
import { useApp } from "../context/AppContext";
import { rotateCanvas } from "../lib/crop";
import { applyEraseMask, createEraseMask, paintBrushStroke, fillLassoRegion } from "../lib/eraser";
import { drawProgressive } from "../lib/drawProgressive";

const LOUPE_CSS = 260;
const LOUPE_ZOOM = 2.5;
const LOUPE_OFFSET = 24;

export default function CropPreview({
  eraserActive = false,
  eraserTool = "brush",
  brushSize = 20,
  previewBg = "checker",
  guidePlacementAxis,
  onGuidePlaced,
}: {
  eraserActive?: boolean;
  eraserTool?: "brush" | "lasso";
  brushSize?: number;
  previewBg?: "checker" | "black" | "white" | "gray";
  guidePlacementAxis?: "h" | "v" | null;
  onGuidePlaced?: () => void;
} = {}) {
  const { state, dispatch } = useApp();
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const loupeRef = useRef<HTMLCanvasElement>(null);
  const drawRef = useRef<() => void>(() => {});

  // Full-res source for loupe sampling
  const sourceRef = useRef<HTMLCanvasElement | null>(null);
  // CSS display size → source pixel mapping
  const scaleInfoRef = useRef<{ cssW: number; cssH: number; srcW: number; srcH: number } | null>(null);

  const erasingRef = useRef(false);
  const brushPointsRef = useRef<[number, number][]>([]);
  const lassoPointsRef = useRef<[number, number][]>([]);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  // Working mask: mutated during drag, committed to state on mouseUp
  const workingMaskRef = useRef<import("../lib/types").EraseMask | null>(null);

  // Guide line drag state
  const guideDragRef = useRef<{ index: number } | null>(null);

  // Refs for loupe rendering (synced via useEffect to avoid lint errors)
  const guideLinesRef = useRef<{ pos: number; axis: "h" | "v" }[]>([]);
  const showGuidesRef = useRef(false);

  // Reset eraser state when switching tools or deactivating
  useEffect(() => {
    erasingRef.current = false;
    brushPointsRef.current = [];
    lassoPointsRef.current = [];
    workingMaskRef.current = null;
    const overlay = overlayRef.current;
    if (overlay) {
      const ctx = overlay.getContext("2d");
      if (ctx) ctx.clearRect(0, 0, overlay.width, overlay.height);
    }
  }, [eraserTool, eraserActive]);

  // Sync guide line refs for loupe rendering
  useEffect(() => {
    guideLinesRef.current = state.refLines;
    showGuidesRef.current = state.showGuides;
  });

  const [loupeVisible, setLoupeVisible] = useState(false);
  const [lassoProcessing, setLassoProcessing] = useState(false);

  const selectedImage = state.images.find(
    (img) => img.id === state.selectedImageId,
  );

  // Map client coords to source coords. clamp=true allows out-of-bounds (for lasso).
  const clientToSource = useCallback(
    (clientX: number, clientY: number, clamp = false): [number, number] | null => {
      const canvas = canvasRef.current;
      const info = scaleInfoRef.current;
      if (!canvas || !info) return null;
      const rect = canvas.getBoundingClientRect();
      const relX = (clientX - rect.left) / rect.width;
      const relY = (clientY - rect.top) / rect.height;
      if (!clamp && (relX < 0 || relX > 1 || relY < 0 || relY > 1)) return null;
      const sx = Math.max(0, Math.min(info.srcW - 1, relX * info.srcW));
      const sy = Math.max(0, Math.min(info.srcH - 1, relY * info.srcH));
      return [sx, sy];
    },
    [],
  );

  // Hit-test: find guide line index near the given client coordinates
  const getGuideLineAt = useCallback(
    (clientX: number, clientY: number): number | null => {
      const canvas = canvasRef.current;
      if (!canvas) return null;
      const rect = canvas.getBoundingClientRect();
      const relX = (clientX - rect.left) / rect.width;
      const relY = (clientY - rect.top) / rect.height;
      const lines = state.refLines;
      const hitThreshold = 8 / Math.max(rect.width, rect.height);
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].axis === "h" && Math.abs(lines[i].pos - relY) < hitThreshold) return i;
        if (lines[i].axis === "v" && Math.abs(lines[i].pos - relX) < hitThreshold) return i;
      }
      return null;
    },
    [state.refLines],
  );

  const getOrCreateMask = useCallback((): import("../lib/types").EraseMask | null => {
    if (!selectedImage?.editState || !selectedImage.filteredCanvas) return null;
    const existing = selectedImage.editState.eraseMask;
    if (existing) {
      // Return a mutable copy for this editing session
      return { width: existing.width, height: existing.height, data: new Uint8Array(existing.data) };
    }
    const fc = selectedImage.filteredCanvas;
    return createEraseMask(fc.width, fc.height);
  }, [selectedImage]);

  const drawLassoOverlay = useCallback(() => {
    const overlay = overlayRef.current;
    const canvas = canvasRef.current;
    const info = scaleInfoRef.current;
    if (!overlay || !canvas || !info) return;

    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    overlay.width = Math.round(rect.width * dpr);
    overlay.height = Math.round(rect.height * dpr);
    overlay.style.width = `${rect.width}px`;
    overlay.style.height = `${rect.height}px`;
    overlay.style.left = canvas.style.left;
    overlay.style.top = canvas.style.top;

    const ctx = overlay.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, overlay.width, overlay.height);

    const points = lassoPointsRef.current;
    if (points.length < 2) return;

    ctx.strokeStyle = "rgba(255, 100, 100, 0.8)";
    ctx.lineWidth = 2 * dpr;
    ctx.beginPath();
    ctx.moveTo(
      (points[0][0] / info.srcW) * overlay.width,
      (points[0][1] / info.srcH) * overlay.height,
    );
    for (let i = 1; i < points.length; i++) {
      ctx.lineTo(
        (points[i][0] / info.srcW) * overlay.width,
        (points[i][1] / info.srcH) * overlay.height,
      );
    }
    ctx.stroke();
  }, []);

  // Draw loupe content at current mouse position
  const drawLoupe = useCallback((clientX: number, clientY: number) => {
    const loupe = loupeRef.current;
    const canvas = canvasRef.current;
    const source = sourceRef.current;
    const info = scaleInfoRef.current;
    if (!loupe || !canvas || !source || !info) return;

    const dpr = window.devicePixelRatio || 1;
    const loupePx = Math.round(LOUPE_CSS * dpr);
    if (loupe.width !== loupePx || loupe.height !== loupePx) {
      loupe.width = loupePx;
      loupe.height = loupePx;
    }

    // Map mouse (client coords) → relative position on the preview canvas
    const rect = canvas.getBoundingClientRect();
    const relX = (clientX - rect.left) / rect.width;
    const relY = (clientY - rect.top) / rect.height;

    // Check if cursor is over the preview canvas
    if (relX < 0 || relX > 1 || relY < 0 || relY > 1) {
      loupe.style.opacity = "0";
      return;
    }
    loupe.style.opacity = "1";

    // Source pixel at cursor center
    const srcX = relX * info.srcW;
    const srcY = relY * info.srcH;

    // How many source pixels the loupe shows
    const regionW = info.srcW / (info.cssW * dpr) * loupePx / LOUPE_ZOOM;
    const regionH = info.srcH / (info.cssH * dpr) * loupePx / LOUPE_ZOOM;

    const ctx = loupe.getContext("2d");
    if (!ctx) return;

    ctx.clearRect(0, 0, loupePx, loupePx);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(
      source,
      srcX - regionW / 2, srcY - regionH / 2, regionW, regionH,
      0, 0, loupePx, loupePx,
    );

    // Crosshair
    const half = loupePx / 2;
    const gap = 6 * dpr;
    const armLen = 14 * dpr;
    ctx.strokeStyle = "rgba(255,255,255,0.7)";
    ctx.lineWidth = 1.5 * dpr;
    ctx.beginPath();
    ctx.moveTo(half - gap - armLen, half); ctx.lineTo(half - gap, half);
    ctx.moveTo(half + gap, half); ctx.lineTo(half + gap + armLen, half);
    ctx.moveTo(half, half - gap - armLen); ctx.lineTo(half, half - gap);
    ctx.moveTo(half, half + gap); ctx.lineTo(half, half + gap + armLen);
    ctx.stroke();

    // Draw guide lines in loupe
    if (showGuidesRef.current) {
      const guideLines = guideLinesRef.current;
      ctx.save();
      ctx.strokeStyle = "rgba(92, 224, 194, 0.5)";
      ctx.lineWidth = 2 * dpr;
      ctx.shadowColor = "rgba(92, 224, 194, 0.3)";
      ctx.shadowBlur = 2 * dpr;
      for (const line of guideLines) {
        if (line.axis === "h") {
          const lineY = line.pos * info.srcH;
          const loupeY = ((lineY - (srcY - regionH / 2)) / regionH) * loupePx;
          if (loupeY >= 0 && loupeY <= loupePx) {
            ctx.beginPath();
            ctx.moveTo(0, loupeY);
            ctx.lineTo(loupePx, loupeY);
            ctx.stroke();
          }
        } else {
          const lineX = line.pos * info.srcW;
          const loupeX = ((lineX - (srcX - regionW / 2)) / regionW) * loupePx;
          if (loupeX >= 0 && loupeX <= loupePx) {
            ctx.beginPath();
            ctx.moveTo(loupeX, 0);
            ctx.lineTo(loupeX, loupePx);
            ctx.stroke();
          }
        }
      }
      ctx.restore();
    }

    // Position loupe near cursor (offset so it doesn't obscure the area)
    const containerRect = containerRef.current?.getBoundingClientRect();
    if (!containerRect) return;
    let lx = clientX - containerRect.left + LOUPE_OFFSET;
    let ly = clientY - containerRect.top + LOUPE_OFFSET;

    // Flip if near right/bottom edge
    if (lx + LOUPE_CSS > containerRect.width) {
      lx = clientX - containerRect.left - LOUPE_CSS - LOUPE_OFFSET;
    }
    if (ly + LOUPE_CSS > containerRect.height) {
      ly = clientY - containerRect.top - LOUPE_CSS - LOUPE_OFFSET;
    }

    loupe.style.left = `${lx}px`;
    loupe.style.top = `${ly}px`;
  }, []);

  // Draw source canvas onto display canvas with DPR scaling
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const rect = container.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;

    const cropCanvas = selectedImage?.cropCanvas;
    const filteredCanvas = selectedImage?.filteredCanvas;
    const filterType = selectedImage?.editState?.filterConfig?.type ?? "none";
    const rotation = selectedImage?.editState?.rotation ?? 0;

    let sourceCanvas =
      filterType !== "none" && filteredCanvas ? filteredCanvas : cropCanvas;

    // Apply eraseMask BEFORE rotation (mask coords match filteredCanvas space)
    const eraseMask = selectedImage?.editState?.eraseMask;
    if (eraseMask && filterType !== "none" && sourceCanvas) {
      sourceCanvas = applyEraseMask(sourceCanvas, eraseMask);
    }

    const displayCanvas = sourceCanvas ?? selectedImage?.originalCanvas ?? null;

    if (!displayCanvas) {
      canvas.width = 0;
      canvas.height = 0;
      sourceRef.current = null;
      scaleInfoRef.current = null;
      return;
    }

    const rotated =
      rotation !== 0 && sourceCanvas
        ? rotateCanvas(sourceCanvas, rotation)
        : displayCanvas;

    // Store full-res source for loupe
    sourceRef.current = rotated instanceof HTMLCanvasElement ? rotated : displayCanvas;

    const srcW = rotated.width;
    const srcH = rotated.height;

    const pad = 32;
    const availW = rect.width - pad;
    const availH = rect.height - pad;
    if (availW <= 0 || availH <= 0) return;

    const scale = Math.min(availW / srcW, availH / srcH);
    const cssW = Math.round(srcW * scale);
    const cssH = Math.round(srcH * scale);

    scaleInfoRef.current = { cssW, cssH, srcW, srcH };

    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    canvas.style.width = `${cssW}px`;
    canvas.style.height = `${cssH}px`;
    // Center the absolute-positioned canvas
    canvas.style.left = `${Math.round((rect.width - cssW) / 2)}px`;
    canvas.style.top = `${Math.round((rect.height - cssH) / 2)}px`;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    drawProgressive(ctx, rotated, canvas.width, canvas.height);

    // Draw reference guide lines
    if (state.showGuides) {
      const lines = state.refLines;
      if (lines.length > 0) {
        ctx.save();
        const dpr = window.devicePixelRatio || 1;
        ctx.lineWidth = 1 * dpr;
        ctx.strokeStyle = "rgba(92, 224, 194, 0.5)";
        ctx.shadowColor = "rgba(92, 224, 194, 0.3)";
        ctx.shadowBlur = 3 * dpr;
        for (const line of lines) {
          ctx.beginPath();
          if (line.axis === "h") {
            const y = Math.round(line.pos * canvas.height);
            ctx.moveTo(0, y);
            ctx.lineTo(canvas.width, y);
          } else {
            const x = Math.round(line.pos * canvas.width);
            ctx.moveTo(x, 0);
            ctx.lineTo(x, canvas.height);
          }
          ctx.stroke();
        }
        ctx.restore();
      }
    }
  }, [
    selectedImage?.cropCanvas,
    selectedImage?.filteredCanvas,
    selectedImage?.editState?.rotation,
    selectedImage?.editState?.filterConfig?.type,
    selectedImage?.editState?.eraseMask,
    selectedImage?.originalCanvas,
    state.showGuides,
    state.refLines,
  ]);

  useEffect(() => {
    drawRef.current = draw;
  });

  useEffect(() => {
    draw();
  }, [draw]);

  // Poll container size on every frame — ResizeObserver unreliable in this flex layout
  useEffect(() => {
    let prevW = 0;
    let prevH = 0;
    let rafId: number;
    const check = () => {
      const el = containerRef.current;
      if (el) {
        const w = el.clientWidth;
        const h = el.clientHeight;
        if (w !== prevW || h !== prevH) {
          prevW = w;
          prevH = h;
          drawRef.current();
        }
      }
      rafId = requestAnimationFrame(check);
    };
    rafId = requestAnimationFrame(check);
    return () => cancelAnimationFrame(rafId);
  }, []);

  // Draw brush strokes directly onto the display canvas (no React state update)
  const drawBrushOnCanvas = useCallback((points: [number, number][]) => {
    const canvas = canvasRef.current;
    const info = scaleInfoRef.current;
    if (!canvas || !info) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const scaleX = canvas.width / info.srcW;
    const scaleY = canvas.height / info.srcH;

    ctx.fillStyle = "#ffffff";
    for (const [cx, cy] of points) {
      const px = cx * scaleX;
      const py = cy * scaleY;
      // Draw ellipse matching the exact brush radius in each axis
      ctx.beginPath();
      ctx.ellipse(px, py, brushSize * scaleX, brushSize * scaleY, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }, [brushSize]);

  // Eraser pointer handlers
  const handleEraserPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (!eraserActive || !selectedImage?.id || !selectedImage.editState) return;
      const pt = clientToSource(e.clientX, e.clientY, true);
      if (!pt) return;

      // Capture pointer so events continue even outside the container
      (e.target as HTMLElement).setPointerCapture(e.pointerId);

      erasingRef.current = true;
      dispatch({ type: "PUSH_HISTORY", id: selectedImage.id });

      if (eraserTool === "brush") {
        // Create working mask once, paint on it during drag, commit on mouseUp
        const mask = getOrCreateMask();
        if (mask) {
          workingMaskRef.current = mask;
          paintBrushStroke(mask, [pt], brushSize);
          drawBrushOnCanvas([pt]);
        }
        brushPointsRef.current = [pt];
      } else {
        lassoPointsRef.current = [pt];
      }
    },
    [eraserActive, eraserTool, brushSize, selectedImage, clientToSource, getOrCreateMask, dispatch, drawBrushOnCanvas],
  );

  const handleEraserPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!erasingRef.current || !selectedImage?.id || !selectedImage.editState) return;
      const pt = clientToSource(e.clientX, e.clientY, true);
      if (!pt) return;

      if (eraserTool === "brush") {
        brushPointsRef.current.push(pt);
        const mask = workingMaskRef.current;
        if (mask) {
          paintBrushStroke(mask, [pt], brushSize);
          drawBrushOnCanvas([pt]);
        }
      } else {
        lassoPointsRef.current.push(pt);
        drawLassoOverlay();
      }
    },
    [eraserTool, brushSize, selectedImage, clientToSource, drawLassoOverlay, drawBrushOnCanvas],
  );

  const handleEraserPointerUp = useCallback(() => {
    if (!erasingRef.current || !selectedImage?.id || !selectedImage.editState) return;
    erasingRef.current = false;

    if (eraserTool === "brush") {
      // Commit the working mask to state
      const mask = workingMaskRef.current;
      if (mask) {
        dispatch({
          type: "SET_EDIT_STATE",
          id: selectedImage.id,
          editState: { ...selectedImage.editState, eraseMask: mask },
        });
        workingMaskRef.current = null;
      }
    } else {
      const points = lassoPointsRef.current;
      if (points.length >= 3) {
        setLassoProcessing(true);
        const imgId = selectedImage.id;
        const editState = selectedImage.editState;
        // Double-rAF ensures the spinner paints before blocking computation
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            const mask = getOrCreateMask();
            if (mask) {
              fillLassoRegion(mask, points);
              dispatch({
                type: "SET_EDIT_STATE",
                id: imgId,
                editState: { ...editState, eraseMask: mask },
              });
            }
            setLassoProcessing(false);
          });
        });
      }
      lassoPointsRef.current = [];
      const overlay = overlayRef.current;
      if (overlay) {
        const ctx = overlay.getContext("2d");
        if (ctx) ctx.clearRect(0, 0, overlay.width, overlay.height);
      }
    }
    brushPointsRef.current = [];
  }, [eraserTool, selectedImage, getOrCreateMask, dispatch]);

  // Pointer handlers — direct DOM manipulation for 60fps loupe tracking
  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (eraserActive) {
        handleEraserPointerMove(e);
        return;
      }
      if (!loupeVisible) setLoupeVisible(true);
      drawLoupe(e.clientX, e.clientY);
    },
    [eraserActive, handleEraserPointerMove, loupeVisible, drawLoupe],
  );

  const handlePointerLeave = useCallback(() => {
    setLoupeVisible(false);
    // Don't cancel eraser on leave — pointer capture keeps it active until pointerUp
  }, []);

  // Build a circular cursor matching the brush size in display coordinates
  const [cursorScale, setCursorScale] = useState(1);
  useEffect(() => {
    const info = scaleInfoRef.current;
    if (info && info.srcW > 0) {
      // Use cssW (not getBoundingClientRect) to match the draw coordinate space
      setCursorScale(info.cssW / info.srcW);
    }
  }, [selectedImage?.cropCanvas, selectedImage?.editState?.rotation, selectedImage?.filteredCanvas]);

  // Guide placement click handler
  const handleGuidePlacementDown = useCallback(
    (e: React.PointerEvent) => {
      if (!guidePlacementAxis || eraserActive) return false;
      const canvas = canvasRef.current;
      if (!canvas) return false;
      const rect = canvas.getBoundingClientRect();
      const pos = guidePlacementAxis === "h"
        ? (e.clientY - rect.top) / rect.height
        : (e.clientX - rect.left) / rect.width;
      if (pos >= 0 && pos <= 1) {
        dispatch({ type: "SET_REF_LINES", lines: [...state.refLines, { pos, axis: guidePlacementAxis }] });
        onGuidePlaced?.();
      }
      return true;
    },
    [guidePlacementAxis, eraserActive, state.refLines, dispatch, onGuidePlaced],
  );

  // Guide line drag handlers
  const handleGuidePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (!state.showGuides || eraserActive) return;
      const hitIdx = getGuideLineAt(e.clientX, e.clientY);
      if (hitIdx != null) {
        e.preventDefault();
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
        guideDragRef.current = { index: hitIdx };
      }
    },
    [state.showGuides, eraserActive, getGuideLineAt],
  );

  const handleGuidePointerMove = useCallback(
    (e: React.PointerEvent) => {
      // Update cursor when hovering near a guide line
      if (state.showGuides && !eraserActive && !guideDragRef.current) {
        const hitIdx = getGuideLineAt(e.clientX, e.clientY);
        const container = containerRef.current;
        if (container) {
          if (hitIdx != null) {
            const lines = state.refLines;
            container.style.cursor = lines[hitIdx]?.axis === "h" ? "ns-resize" : "ew-resize";
          } else {
            container.style.cursor = "";
          }
        }
      }

      if (!guideDragRef.current) return;
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const relX = (e.clientX - rect.left) / rect.width;
      const relY = (e.clientY - rect.top) / rect.height;
      const { index } = guideDragRef.current;
      const lines = [...state.refLines];
      const axis = lines[index].axis;
      lines[index] = { ...lines[index], pos: Math.max(0, Math.min(1, axis === "h" ? relY : relX)) };
      dispatch({ type: "SET_REF_LINES", lines });
    },
    [state.showGuides, eraserActive, getGuideLineAt, state.refLines, dispatch],
  );

  const handleGuidePointerUp = useCallback(
    (e: React.PointerEvent) => {
      if (!guideDragRef.current) {
        // Click-to-place handled by handleGuidePlacementDown
        return;
      }

      // Drag end — remove if dragged outside canvas
      const canvas = canvasRef.current;
      if (canvas) {
        const rect = canvas.getBoundingClientRect();
        const relX = (e.clientX - rect.left) / rect.width;
        const relY = (e.clientY - rect.top) / rect.height;
        const { index } = guideDragRef.current;
        const lines = [...state.refLines];
        const axis = lines[index].axis;
        const outOfBounds = axis === "h"
          ? (relY < -0.02 || relY > 1.02)
          : (relX < -0.02 || relX > 1.02);
        if (outOfBounds) {
          lines.splice(index, 1);
          dispatch({ type: "SET_REF_LINES", lines });
        }
      }
      guideDragRef.current = null;
    },
    [state.refLines, dispatch],
  );

  const brushCursor = useMemo(() => {
    if (guidePlacementAxis && !eraserActive) return "crosshair";
    if (!eraserActive || eraserTool !== "brush") return "crosshair";
    const r = Math.max(2, Math.round(brushSize * cursorScale));
    const size = r * 2 + 2;
    const half = size / 2;
    const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${size}' height='${size}'><circle cx='${half}' cy='${half}' r='${r}' fill='none' stroke='white' stroke-width='1.5'/><circle cx='${half}' cy='${half}' r='${r}' fill='none' stroke='black' stroke-width='0.5'/></svg>`;
    return `url("data:image/svg+xml,${encodeURIComponent(svg)}") ${half} ${half}, crosshair`;
  }, [eraserActive, eraserTool, brushSize, cursorScale, guidePlacementAxis]);

  // Delete/Backspace removes the last reference line
  useEffect(() => {
    if (!state.showGuides) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Delete" || e.key === "Backspace") {
        const tag = (e.target as HTMLElement)?.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA") return;
        const lines = [...state.refLines];
        if (lines.length === 0) return;
        e.preventDefault();
        lines.pop();
        dispatch({ type: "SET_REF_LINES", lines });
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [state.showGuides, state.refLines, dispatch]);

  if (!selectedImage || selectedImage.status !== "ready") {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="text-[var(--text-muted)] text-sm">
          {selectedImage?.status === "processing"
            ? "Processing..."
            : "No image"}
        </p>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="flex-1 overflow-hidden relative p-4"
      style={{
        ...(previewBg === "checker" ? {
          backgroundColor: "#3a3a44",
          backgroundImage: "linear-gradient(45deg, #32323a 25%, transparent 25%), linear-gradient(-45deg, #32323a 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #32323a 75%), linear-gradient(-45deg, transparent 75%, #32323a 75%)",
          backgroundSize: "16px 16px",
          backgroundPosition: "0 0, 0 8px, 8px -8px, -8px 0",
        } : {
          backgroundColor: previewBg === "black" ? "#000" : previewBg === "white" ? "#fff" : "#555",
        }),
        cursor: guidePlacementAxis ? "crosshair" : eraserActive ? brushCursor : undefined,
        touchAction: eraserActive ? "none" : undefined,
      }}
      onPointerMove={(e) => {
        handlePointerMove(e);
        handleGuidePointerMove(e);
      }}
      onPointerDown={(e) => {
        if (handleGuidePlacementDown(e)) return;
        if (eraserActive) {
          handleEraserPointerDown(e);
        } else {
          handleGuidePointerDown(e);
        }
      }}
      onPointerUp={(e) => {
        if (eraserActive) {
          handleEraserPointerUp();
        }
        handleGuidePointerUp(e);
      }}
      onPointerLeave={handlePointerLeave}
      onContextMenu={(e) => {
        if (!state.showGuides) return;
        const hitIdx = getGuideLineAt(e.clientX, e.clientY);
        if (hitIdx != null) {
          e.preventDefault();
          const lines = [...state.refLines];
          lines.splice(hitIdx, 1);
          dispatch({ type: "SET_REF_LINES", lines });
        }
      }}
    >
      <canvas ref={canvasRef} aria-label="Crop preview" style={{ position: "absolute" }} />
      {/* Lasso processing spinner */}
      {lassoProcessing && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/40 z-20">
          <div className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--bg-elevated)] shadow-lg">
            <div className="w-4 h-4 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
            <span className="text-xs text-[var(--text-secondary)]">Applying...</span>
          </div>
        </div>
      )}
      {/* Lasso overlay */}
      <canvas
        ref={overlayRef}
        className="pointer-events-none absolute"
        style={{
          opacity: eraserActive && eraserTool === "lasso" ? 1 : 0,
        }}
      />
      {/* Loupe (hidden when eraser is active) */}
      <canvas
        ref={loupeRef}
        className="pointer-events-none absolute rounded-full shadow-lg"
        style={{
          width: LOUPE_CSS,
          height: LOUPE_CSS,
          opacity: loupeVisible && !eraserActive ? 1 : 0,
          transition: "opacity 150ms",
          border: "2px solid rgba(255,255,255,0.15)",
          background: "var(--bg-secondary)",
        }}
      />
    </div>
  );
}
