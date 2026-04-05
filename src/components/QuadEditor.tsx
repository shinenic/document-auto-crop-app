"use client";

import { useRef, useState, useEffect, useCallback } from "react";
import { useApp } from "../context/AppContext";
import type { PointSelection } from "../lib/types";
import { renderMaskOverlay } from "../lib/overlay";

const LOUPE_CSS = 320;
const LOUPE_ZOOM_CORNER = 3;
const LOUPE_ZOOM_CP = 1.8;

// Canvas colors — mirror design tokens (canvas API can't read CSS vars)
const CANVAS_BG = "#111115";        // --bg-secondary
const EDGE_STROKE = "#4dd4b4";      // --accent
const GUIDE_STROKE = "rgba(100, 150, 255, 0.6)";
const CP_FILL = "rgba(77, 212, 180, 0.4)";         // accent-derived
const CP_FILL_SEL = "rgba(77, 212, 180, 0.7)";
const CORNER_FILL = "rgba(232, 85, 85, 0.15)";     // danger-derived
const CORNER_FILL_SEL = "rgba(232, 85, 85, 0.35)";

interface Props {
  onDragStart: () => void;
  onDragEnd: () => void;
}

export default function QuadEditor({ onDragStart, onDragEnd }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const loupeRef = useRef<HTMLCanvasElement>(null);
  const { state, dispatch } = useApp();
  const selectedImage = state.images.find(
    (img) => img.id === state.selectedImageId,
  );

  const [selected, setSelected] = useState<PointSelection | null>(null);
  const [dragging, setDragging] = useState(false);
  const [loupeCorner, setLoupeCorner] = useState<"tl" | "tr" | "bl" | "br">("tr");
  const [baseCanvas, setBaseCanvas] = useState<HTMLCanvasElement | null>(null);
  const dragStartRef = useRef(false);
  const dragPosRef = useRef<[number, number]>([0, 0]);

  useEffect(() => {
    if (!selectedImage?.originalCanvas || !selectedImage.mask) return;
    const base = renderMaskOverlay(
      selectedImage.originalCanvas,
      selectedImage.mask,
      selectedImage.maskWidth,
      selectedImage.maskHeight,
    );
    setBaseCanvas(base);
  }, [
    selectedImage?.originalCanvas,
    selectedImage?.mask,
    selectedImage?.maskWidth,
    selectedImage?.maskHeight,
  ]);

  const editState = selectedImage?.editState;
  const imgW = selectedImage?.originalCanvas?.width ?? 1;
  const imgH = selectedImage?.originalCanvas?.height ?? 1;
  const maskWidth = selectedImage?.maskWidth ?? 256;
  const maskHeight = selectedImage?.maskHeight ?? 256;

  const padX = Math.round(imgW * 0.15);
  const padY = Math.round(imgH * 0.15);
  const canW = imgW + padX * 2;
  const canH = imgH + padY * 2;

  const getScale = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return { sx: 1, sy: 1 };
    return { sx: canW / canvas.clientWidth, sy: canH / canvas.clientHeight };
  }, [canW, canH]);

  const maskToCanvas = useCallback(
    (mx: number, my: number): [number, number] => [
      mx * (imgW / maskWidth) + padX,
      my * (imgH / maskHeight) + padY,
    ],
    [imgW, imgH, maskWidth, maskHeight, padX, padY],
  );

  // --- Magnifier ---
  const drawLoupe = useCallback(() => {
    const loupe = loupeRef.current;
    const main = canvasRef.current;
    if (!loupe || !main || !dragging) return;
    const dpr = window.devicePixelRatio || 1;
    const loupePx = LOUPE_CSS * dpr;
    loupe.width = loupePx;
    loupe.height = loupePx;
    const ctx = loupe.getContext("2d")!;
    ctx.imageSmoothingEnabled = true;
    const zoom = selected?.type === "corner" ? LOUPE_ZOOM_CORNER : LOUPE_ZOOM_CP;
    const canvasPerCss = canW / main.clientWidth;
    const srcSize = (LOUPE_CSS * canvasPerCss) / zoom;
    const [cx, cy] = dragPosRef.current;
    ctx.drawImage(main, cx - srcSize / 2, cy - srcSize / 2, srcSize, srcSize, 0, 0, loupePx, loupePx);
    const half = loupePx / 2;
    const gap = 8 * dpr, armLen = 20 * dpr;
    ctx.strokeStyle = "rgba(255,255,255,0.8)";
    ctx.lineWidth = 1.5 * dpr;
    ctx.beginPath();
    ctx.moveTo(half - gap - armLen, half); ctx.lineTo(half - gap, half);
    ctx.moveTo(half + gap, half); ctx.lineTo(half + gap + armLen, half);
    ctx.moveTo(half, half - gap - armLen); ctx.lineTo(half, half - gap);
    ctx.moveTo(half, half + gap); ctx.lineTo(half, half + gap + armLen);
    ctx.stroke();
    ctx.strokeStyle = "rgba(255,255,255,0.3)";
    ctx.lineWidth = 2 * dpr;
    ctx.strokeRect(0, 0, loupePx, loupePx);
  }, [dragging, canW, selected]);

  // --- Draw ---
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !baseCanvas || !editState) return;
    canvas.width = canW;
    canvas.height = canH;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = CANVAS_BG;
    ctx.fillRect(0, 0, canW, canH);
    ctx.drawImage(baseCanvas, padX, padY);
    ctx.translate(padX, padY);

    const sx = imgW / maskWidth;
    const sy = imgH / maskHeight;
    const lw = Math.max(2, Math.round(imgW / 250));
    const cornerR = Math.max(10, Math.round(imgW / 45));
    const cornerRSel = Math.max(14, Math.round(imgW / 30));
    const cpR = Math.max(6, Math.round(imgW / 80));
    const cpRSel = Math.max(10, Math.round(imgW / 50));

    const { corners, edgeFits } = editState;

    // Draw edges
    ctx.beginPath();
    ctx.moveTo(corners[0][0] * sx, corners[0][1] * sy);
    for (let i = 0; i < 4; i++) {
      const end = corners[(i + 1) % 4];
      const fit = edgeFits[i];
      if (!fit.isArc) {
        ctx.lineTo(end[0] * sx, end[1] * sy);
      } else {
        ctx.bezierCurveTo(
          fit.cp1[0] * sx, fit.cp1[1] * sy,
          fit.cp2[0] * sx, fit.cp2[1] * sy,
          end[0] * sx, end[1] * sy,
        );
      }
    }
    ctx.closePath();
    ctx.lineWidth = lw;
    ctx.strokeStyle = EDGE_STROKE;
    ctx.stroke();

    // Draw CPs and guide lines
    for (let i = 0; i < 4; i++) {
      const fit = edgeFits[i];
      if (!fit.isArc) continue;
      const start = corners[i], end = corners[(i + 1) % 4];

      ctx.setLineDash([6, 6]);
      ctx.lineWidth = Math.max(1, lw / 2);
      ctx.strokeStyle = GUIDE_STROKE;
      ctx.beginPath(); ctx.moveTo(start[0] * sx, start[1] * sy); ctx.lineTo(fit.cp1[0] * sx, fit.cp1[1] * sy); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(end[0] * sx, end[1] * sy); ctx.lineTo(fit.cp2[0] * sx, fit.cp2[1] * sy); ctx.stroke();
      ctx.setLineDash([]);

      for (const [cpKey, cp] of [["cp1", fit.cp1], ["cp2", fit.cp2]] as const) {
        const sel = selected?.type === cpKey && selected?.edgeIdx === i;
        ctx.beginPath();
        ctx.arc(cp[0] * sx, cp[1] * sy, sel ? cpRSel : cpR, 0, 2 * Math.PI);
        ctx.fillStyle = sel ? CP_FILL_SEL : CP_FILL;
        ctx.fill();
        ctx.strokeStyle = "#fff";
        ctx.lineWidth = Math.max(1, lw / 2);
        ctx.stroke();
      }
    }

    // Draw corners
    for (let i = 0; i < 4; i++) {
      const sel = selected?.type === "corner" && selected?.edgeIdx === i;
      const cr = sel ? cornerRSel : cornerR;
      const cx = corners[i][0] * sx, cy = corners[i][1] * sy;
      ctx.beginPath();
      ctx.arc(cx, cy, cr, 0, 2 * Math.PI);
      ctx.fillStyle = sel ? CORNER_FILL_SEL : CORNER_FILL;
      ctx.fill();
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = sel ? 4 : 3;
      ctx.stroke();
    }
  }, [baseCanvas, editState, selected, imgW, imgH, canW, canH, padX, padY, maskWidth, maskHeight]);

  useEffect(() => { draw(); drawLoupe(); }, [draw, drawLoupe]);

  // --- Hit detection ---
  const getAllPoints = useCallback(() => {
    if (!editState) return [];
    const pts: { type: "corner" | "cp1" | "cp2"; edgeIdx: number; pos: [number, number] }[] = [];
    for (let i = 0; i < 4; i++) {
      pts.push({ type: "corner", edgeIdx: i, pos: editState.corners[i] });
    }
    for (let i = 0; i < 4; i++) {
      if (!editState.edgeFits[i].isArc) continue;
      pts.push({ type: "cp1", edgeIdx: i, pos: editState.edgeFits[i].cp1 });
      pts.push({ type: "cp2", edgeIdx: i, pos: editState.edgeFits[i].cp2 });
    }
    return pts;
  }, [editState]);

  const toMaskFromPointer = useCallback(
    (e: React.PointerEvent): [number, number] => {
      const canvas = canvasRef.current;
      if (!canvas) return [0, 0];
      const rect = canvas.getBoundingClientRect();
      const { sx, sy } = getScale();
      const cx = (e.clientX - rect.left) * sx - padX;
      const cy = (e.clientY - rect.top) * sy - padY;
      return [cx / (imgW / maskWidth), cy / (imgH / maskHeight)];
    },
    [getScale, padX, padY, imgW, imgH, maskWidth, maskHeight],
  );

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (!editState || !selectedImage) return;
      const canvas = canvasRef.current;
      if (canvas) canvas.setPointerCapture(e.pointerId);
      const [mx, my] = toMaskFromPointer(e);
      const pts = getAllPoints();
      let bestDist = Infinity;
      let bestPt: (typeof pts)[0] | null = null;
      for (const pt of pts) {
        const d = Math.hypot(pt.pos[0] - mx, pt.pos[1] - my);
        if (d < bestDist) { bestDist = d; bestPt = pt; }
      }
      const { sx } = getScale();
      const hitR = (Math.max(12, Math.round(imgW / 40)) * sx) / (imgW / maskWidth);
      if (bestPt && bestDist < hitR) {
        setSelected({ type: bestPt.type, edgeIdx: bestPt.edgeIdx });
        setDragging(true);
        dragStartRef.current = false;
        dragPosRef.current = maskToCanvas(mx, my);
        // Place loupe at diagonal opposite corner
        const left = mx < maskWidth / 2;
        const top = my < maskHeight / 2;
        setLoupeCorner(left ? (top ? "br" : "tr") : top ? "bl" : "tl");
      } else {
        setSelected(null);
      }
    },
    [editState, selectedImage, toMaskFromPointer, getAllPoints, getScale, imgW, maskWidth, maskHeight, maskToCanvas],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!dragging || !selected || !editState || !selectedImage) return;
      const [mx, my] = toMaskFromPointer(e);

      if (!dragStartRef.current) {
        dispatch({ type: "PUSH_HISTORY", id: selectedImage.id });
        dragStartRef.current = true;
        onDragStart();
      }

      dragPosRef.current = maskToCanvas(mx, my);

      const { type, edgeIdx } = selected;
      if (type === "corner") {
        const corners = editState.corners.map((c) => [...c] as [number, number]);
        corners[edgeIdx] = [mx, my];
        const edgeFits = editState.edgeFits.map((f) => ({
          cp1: [...f.cp1] as [number, number],
          cp2: [...f.cp2] as [number, number],
          isArc: f.isArc,
        }));
        for (const adj of [edgeIdx, (edgeIdx + 3) % 4]) {
          if (!edgeFits[adj].isArc) {
            const s = corners[adj];
            const e = corners[(adj + 1) % 4];
            edgeFits[adj].cp1 = [s[0] + (e[0] - s[0]) / 3, s[1] + (e[1] - s[1]) / 3];
            edgeFits[adj].cp2 = [s[0] + (2 * (e[0] - s[0])) / 3, s[1] + (2 * (e[1] - s[1])) / 3];
          }
        }
        dispatch({
          type: "SET_EDIT_STATE",
          id: selectedImage.id,
          editState: { ...editState, corners, edgeFits },
        });
      } else {
        const edgeFits = editState.edgeFits.map((f) => ({
          cp1: [...f.cp1] as [number, number],
          cp2: [...f.cp2] as [number, number],
          isArc: f.isArc,
        }));
        edgeFits[edgeIdx][type] = [mx, my];
        dispatch({
          type: "SET_EDIT_STATE",
          id: selectedImage.id,
          editState: { ...editState, edgeFits },
        });
      }
    },
    [dragging, selected, editState, selectedImage, toMaskFromPointer, dispatch, onDragStart, maskToCanvas],
  );

  const handlePointerUp = useCallback(() => {
    if (dragging) {
      setDragging(false);
      if (dragStartRef.current) onDragEnd();
      dragStartRef.current = false;
    }
  }, [dragging, onDragEnd]);

  if (!selectedImage || !editState || !baseCanvas) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="text-[var(--text-muted)] text-sm">
          {selectedImage?.editState === null
            ? 'Crop cancelled \u2014 use "Reset to Prediction" to restore'
            : "Select an image to edit"}
        </p>
      </div>
    );
  }

  return (
    <div className="flex-1 relative flex items-center justify-center p-4 overflow-hidden">
      <canvas
        ref={canvasRef}
        aria-label="Document boundary editor — drag corners and control points to adjust crop"
        className="max-w-full max-h-full"
        style={{ cursor: dragging ? "grabbing" : "pointer", aspectRatio: `${canW} / ${canH}`, touchAction: "none" }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
      />
      <canvas
        ref={loupeRef}
        className="absolute rounded-lg shadow-lg transition-opacity duration-150"
        style={{
          width: LOUPE_CSS, height: LOUPE_CSS,
          opacity: dragging ? 1 : 0,
          pointerEvents: "none",
          border: "1px solid var(--border)",
          background: CANVAS_BG,
          ...(loupeCorner.includes("t") ? { top: 12 } : { bottom: 12 }),
          ...(loupeCorner.includes("r") ? { right: 12 } : { left: 12 }),
        }}
      />
    </div>
  );
}
