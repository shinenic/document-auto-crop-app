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
}: {
  eraserActive?: boolean;
  eraserTool?: "brush" | "lasso";
  brushSize?: number;
  previewBg?: "checker" | "black" | "white" | "gray";
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

    const scale = Math.min(availW / srcW, availH / srcH, 1);
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
  }, [
    selectedImage?.cropCanvas,
    selectedImage?.filteredCanvas,
    selectedImage?.editState?.rotation,
    selectedImage?.editState?.filterConfig?.type,
    selectedImage?.editState?.eraseMask,
    selectedImage?.originalCanvas,
  ]);

  drawRef.current = draw;

  useEffect(() => {
    draw();
  }, [draw]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => drawRef.current());
    ro.observe(el);
    return () => ro.disconnect();
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
        // Defer to next frame so spinner renders before heavy computation
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

  const brushCursor = useMemo(() => {
    if (!eraserActive || eraserTool !== "brush") return "crosshair";
    const r = Math.max(2, Math.round(brushSize * cursorScale));
    const size = r * 2 + 2;
    const half = size / 2;
    const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${size}' height='${size}'><circle cx='${half}' cy='${half}' r='${r}' fill='none' stroke='white' stroke-width='1.5'/><circle cx='${half}' cy='${half}' r='${r}' fill='none' stroke='black' stroke-width='0.5'/></svg>`;
    return `url("data:image/svg+xml,${encodeURIComponent(svg)}") ${half} ${half}, crosshair`;
  }, [eraserActive, eraserTool, brushSize, cursorScale]);

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
        cursor: eraserActive ? brushCursor : undefined,
        touchAction: eraserActive ? "none" : undefined,
      }}
      onPointerMove={handlePointerMove}
      onPointerDown={eraserActive ? handleEraserPointerDown : undefined}
      onPointerUp={eraserActive ? handleEraserPointerUp : undefined}
      onPointerLeave={handlePointerLeave}
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
