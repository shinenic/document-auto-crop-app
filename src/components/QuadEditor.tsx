"use client";

import { useRef, useState, useEffect, useCallback } from "react";
import { useApp } from "../context/AppContext";
import type { PointSelection } from "../lib/types";
import { renderMaskOverlay } from "../lib/overlay";
import { evalBezier } from "../lib/crop";

const LOUPE_CSS = 320;
const LOUPE_ZOOM_CORNER = 3;
const LOUPE_ZOOM_CP = 1.8;

// Canvas colors — mirror design tokens (canvas API can't read CSS vars)
const CANVAS_BG = "#111115";        // --bg-secondary
const EDGE_STROKE = "rgba(255, 180, 60, 0.7)";  // warm orange, contrast with teal mask
const GUIDE_STROKE = "rgba(100, 150, 255, 0.6)";
const CP_FILL = "rgba(77, 212, 180, 0.4)";         // accent-derived
const CP_FILL_SEL = "rgba(77, 212, 180, 0.7)";
const CORNER_FILL = "rgba(232, 85, 85, 0.15)";     // danger-derived
const CORNER_FILL_SEL = "rgba(232, 85, 85, 0.35)";
const EDGE_HANDLE_FILL = "rgba(255, 180, 60, 0.55)";
const EDGE_HANDLE_FILL_SEL = "rgba(255, 180, 60, 0.8)";
const EDGE_HANDLE_GLOW = "rgba(255, 180, 60, 0.3)";

const GUIDE_LINE_STROKE = "rgba(245, 158, 11, 0.8)";
const GUIDE_LINE_STROKE_SEL = "rgba(245, 158, 11, 1)";
const GUIDE_CP_FILL = "rgba(245, 158, 11, 0.4)";
const GUIDE_CP_FILL_SEL = "rgba(245, 158, 11, 0.7)";
const GUIDE_EP_FILL = "rgba(245, 158, 11, 0.5)";
const GUIDE_EP_FILL_SEL = "rgba(245, 158, 11, 0.8)";

interface Props {
  onDragStart: () => void;
  onDragEnd: () => void;
  guideAddMode: boolean;
  guideAddStep?: "left" | "right" | null;
  pendingLeftV?: number | null;
  onGuideAddClick: (mx: number, my: number) => void;
}

export default function QuadEditor({ onDragStart, onDragEnd, guideAddMode, onGuideAddClick }: Props) {
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
  // Offset between cursor and point position at pointerDown
  const dragOffsetRef = useRef<[number, number]>([0, 0]);
  // For edge drag: initial corners and midpoint when drag started
  const edgeDragInitRef = useRef<{
    corners: [[number, number], [number, number]];
    midpoint: [number, number];
  } | null>(null);

  useEffect(() => {
    if (!selectedImage?.originalCanvas) return;
    if (state.showMask && selectedImage.mask) {
      const base = renderMaskOverlay(
        selectedImage.originalCanvas,
        selectedImage.mask,
        selectedImage.maskWidth,
        selectedImage.maskHeight,
      );
      setBaseCanvas(base);
    } else {
      setBaseCanvas(selectedImage.originalCanvas);
    }
  }, [
    selectedImage?.originalCanvas,
    selectedImage?.mask,
    selectedImage?.maskWidth,
    selectedImage?.maskHeight,
    state.showMask,
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
    const lw = Math.max(1.5, Math.round(imgW / 350));
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

    // Draw edge midpoint handles for straight edges
    const ehR = Math.max(8, Math.round(imgW / 60));        // between cpR and cornerR
    const ehRSel = Math.max(11, Math.round(imgW / 45));
    for (let i = 0; i < 4; i++) {
      const fit = edgeFits[i];
      if (fit.isArc) continue;
      const start = corners[i], end = corners[(i + 1) % 4];
      const midX = ((start[0] + end[0]) / 2) * sx;
      const midY = ((start[1] + end[1]) / 2) * sy;
      const sel = selected?.type === "edge" && selected?.edgeIdx === i;
      const r = sel ? ehRSel : ehR;
      const isVert = i === 0 || i === 2;
      // Pill dimensions: elongated along movement axis
      const pillW = isVert ? r * 1.4 : r * 2.4;
      const pillH = isVert ? r * 2.4 : r * 1.4;
      const pillR = Math.min(pillW, pillH) * 0.45; // corner radius

      // Outer glow
      ctx.save();
      ctx.shadowColor = EDGE_HANDLE_GLOW;
      ctx.shadowBlur = r * 0.8;
      ctx.beginPath();
      ctx.roundRect(midX - pillW / 2, midY - pillH / 2, pillW, pillH, pillR);
      ctx.fillStyle = sel ? EDGE_HANDLE_FILL_SEL : EDGE_HANDLE_FILL;
      ctx.fill();
      ctx.restore();

      // Border
      ctx.beginPath();
      ctx.roundRect(midX - pillW / 2, midY - pillH / 2, pillW, pillH, pillR);
      ctx.strokeStyle = sel ? "#fff" : "rgba(255,255,255,0.7)";
      ctx.lineWidth = Math.max(1.5, lw * 0.5);
      ctx.stroke();

      // Directional arrows — larger and bolder
      const aLen = (isVert ? pillH : pillW) * 0.34;
      const aHead = r * 0.38;
      const aStroke = Math.max(2, lw * 0.55);
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = aStroke;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.beginPath();
      if (isVert) {
        // Shaft
        ctx.moveTo(midX, midY - aLen); ctx.lineTo(midX, midY + aLen);
        // Up arrowhead
        ctx.moveTo(midX - aHead, midY - aLen + aHead); ctx.lineTo(midX, midY - aLen); ctx.lineTo(midX + aHead, midY - aLen + aHead);
        // Down arrowhead
        ctx.moveTo(midX - aHead, midY + aLen - aHead); ctx.lineTo(midX, midY + aLen); ctx.lineTo(midX + aHead, midY + aLen - aHead);
      } else {
        // Shaft
        ctx.moveTo(midX - aLen, midY); ctx.lineTo(midX + aLen, midY);
        // Left arrowhead
        ctx.moveTo(midX - aLen + aHead, midY - aHead); ctx.lineTo(midX - aLen, midY); ctx.lineTo(midX - aLen + aHead, midY + aHead);
        // Right arrowhead
        ctx.moveTo(midX + aLen - aHead, midY - aHead); ctx.lineTo(midX + aLen, midY); ctx.lineTo(midX + aLen - aHead, midY + aHead);
      }
      ctx.stroke();
      ctx.lineCap = "butt";
      ctx.lineJoin = "miter";
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
      ctx.lineWidth = sel ? 6 : 5;
      ctx.stroke();
    }

    // Draw guide lines
    const { guideLines } = editState;
    const glLw = Math.max(2, Math.round(imgW / 300));
    const glR = Math.max(5, Math.round(imgW / 90));
    const glRSel = Math.max(8, Math.round(imgW / 60));
    const glCpR = Math.max(4, Math.round(imgW / 100));
    const glCpRSel = Math.max(7, Math.round(imgW / 70));

    for (let gi = 0; gi < guideLines.length; gi++) {
      const g = guideLines[gi];

      // Draw extension lines (dashed) from L/R edges to p0/p3
      // Project endpoints onto L/R edges to find where extensions meet
      const Ledge: [[number, number], [number, number], [number, number], [number, number]] =
        [corners[0], edgeFits[3].cp2, edgeFits[3].cp1, corners[3]];
      const Redge: [[number, number], [number, number], [number, number], [number, number]] =
        [corners[1], edgeFits[1].cp1, edgeFits[1].cp2, corners[2]];

      // Find closest point on L/R edge to p0/p3
      let bestLV = 0.5, bestLD = Infinity;
      let bestRV = 0.5, bestRD = Infinity;
      for (let step = 0; step <= 60; step++) {
        const v = step / 60;
        const lp = evalBezier(Ledge[0], Ledge[1], Ledge[2], Ledge[3], v);
        const dl = Math.hypot(lp[0] - g.p0[0], lp[1] - g.p0[1]);
        if (dl < bestLD) { bestLD = dl; bestLV = v; }
        const rp = evalBezier(Redge[0], Redge[1], Redge[2], Redge[3], v);
        const dr = Math.hypot(rp[0] - g.p3[0], rp[1] - g.p3[1]);
        if (dr < bestRD) { bestRD = dr; bestRV = v; }
      }
      const lEdgePt = evalBezier(Ledge[0], Ledge[1], Ledge[2], Ledge[3], bestLV);
      const rEdgePt = evalBezier(Redge[0], Redge[1], Redge[2], Redge[3], bestRV);

      // Draw dashed extension lines (from edge points to user endpoints)
      ctx.setLineDash([6, 4]);
      ctx.lineWidth = Math.max(1, glLw * 0.7);
      ctx.strokeStyle = "rgba(245, 158, 11, 0.35)";
      if (bestLD > 0.5) {
        ctx.beginPath(); ctx.moveTo(lEdgePt[0] * sx, lEdgePt[1] * sy); ctx.lineTo(g.p0[0] * sx, g.p0[1] * sy); ctx.stroke();
      }
      if (bestRD > 0.5) {
        ctx.beginPath(); ctx.moveTo(g.p3[0] * sx, g.p3[1] * sy); ctx.lineTo(rEdgePt[0] * sx, rEdgePt[1] * sy); ctx.stroke();
      }
      ctx.setLineDash([]);

      // Main Bezier curve (solid)
      ctx.beginPath();
      ctx.moveTo(g.p0[0] * sx, g.p0[1] * sy);
      ctx.bezierCurveTo(g.cp1[0] * sx, g.cp1[1] * sy, g.cp2[0] * sx, g.cp2[1] * sy, g.p3[0] * sx, g.p3[1] * sy);
      const isBodySel = selected?.type === "guide-body" && selected.edgeIdx === gi;
      ctx.lineWidth = isBodySel ? glLw * 1.5 : glLw;
      ctx.strokeStyle = isBodySel ? GUIDE_LINE_STROKE_SEL : GUIDE_LINE_STROKE;
      ctx.stroke();

      // CP guide lines (dashed)
      ctx.setLineDash([4, 4]);
      ctx.lineWidth = Math.max(1, glLw / 2);
      ctx.strokeStyle = "rgba(245, 158, 11, 0.3)";
      ctx.beginPath(); ctx.moveTo(g.p0[0] * sx, g.p0[1] * sy); ctx.lineTo(g.cp1[0] * sx, g.cp1[1] * sy); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(g.p3[0] * sx, g.p3[1] * sy); ctx.lineTo(g.cp2[0] * sx, g.cp2[1] * sy); ctx.stroke();
      ctx.setLineDash([]);

      // CPs (diamonds)
      for (const [cpKey, cp] of [["guide-cp1", g.cp1], ["guide-cp2", g.cp2]] as const) {
        const isSel = selected?.type === cpKey && selected.edgeIdx === gi;
        const r = isSel ? glCpRSel : glCpR;
        const cx = cp[0] * sx, cy = cp[1] * sy;
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(Math.PI / 4);
        ctx.fillStyle = isSel ? GUIDE_CP_FILL_SEL : GUIDE_CP_FILL;
        ctx.fillRect(-r, -r, r * 2, r * 2);
        ctx.strokeStyle = "#fff";
        ctx.lineWidth = Math.max(1, glLw / 3);
        ctx.strokeRect(-r, -r, r * 2, r * 2);
        ctx.restore();
      }

      // Endpoints (circles) — at user-placed p0/p3 positions
      for (const [epKey, ep] of [["guide-left", g.p0], ["guide-right", g.p3]] as const) {
        const isSel = selected?.type === epKey && selected.edgeIdx === gi;
        const r = isSel ? glRSel : glR;
        ctx.beginPath();
        ctx.arc(ep[0] * sx, ep[1] * sy, r, 0, 2 * Math.PI);
        ctx.fillStyle = isSel ? GUIDE_EP_FILL_SEL : GUIDE_EP_FILL;
        ctx.fill();
        ctx.strokeStyle = "#fff";
        ctx.lineWidth = Math.max(1.5, glLw / 2);
        ctx.stroke();
      }
    }
  }, [baseCanvas, editState, selected, imgW, imgH, canW, canH, padX, padY, maskWidth, maskHeight]);

  useEffect(() => { draw(); drawLoupe(); }, [draw, drawLoupe]);

  // --- Delete guide line on Delete/Backspace ---
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (!selected || !editState || !selectedImage) return;
      if (e.key !== "Delete" && e.key !== "Backspace") return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (selected.type.startsWith("guide-")) {
        e.preventDefault();
        const gi = selected.edgeIdx;
        dispatch({ type: "PUSH_HISTORY", id: selectedImage.id });
        const guideLines = editState.guideLines.filter((_, i) => i !== gi);
        dispatch({ type: "SET_EDIT_STATE", id: selectedImage.id, editState: { ...editState, guideLines } });
        setSelected(null);
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [selected, editState, selectedImage, dispatch]);

  // --- Hit detection ---
  const getAllPoints = useCallback(() => {
    if (!editState) return [];
    const pts: { type: PointSelection["type"]; edgeIdx: number; pos: [number, number] }[] = [];
    for (let i = 0; i < 4; i++) {
      pts.push({ type: "corner", edgeIdx: i, pos: editState.corners[i] });
    }
    for (let i = 0; i < 4; i++) {
      if (!editState.edgeFits[i].isArc) continue;
      pts.push({ type: "cp1", edgeIdx: i, pos: editState.edgeFits[i].cp1 });
      pts.push({ type: "cp2", edgeIdx: i, pos: editState.edgeFits[i].cp2 });
    }
    // Edge midpoints for straight edges (lower priority — listed last)
    for (let i = 0; i < 4; i++) {
      if (editState.edgeFits[i].isArc) continue;
      const s = editState.corners[i];
      const e = editState.corners[(i + 1) % 4];
      pts.push({ type: "edge", edgeIdx: i, pos: [(s[0] + e[0]) / 2, (s[1] + e[1]) / 2] });
    }
    // Guide line hit targets — endpoints are at p0/p3 (freely placed)
    for (let gi = 0; gi < editState.guideLines.length; gi++) {
      const g = editState.guideLines[gi];
      pts.push({ type: "guide-left", edgeIdx: gi, pos: g.p0 });
      pts.push({ type: "guide-right", edgeIdx: gi, pos: g.p3 });
      pts.push({ type: "guide-cp1", edgeIdx: gi, pos: g.cp1 });
      pts.push({ type: "guide-cp2", edgeIdx: gi, pos: g.cp2 });
      const mid = evalBezier(g.p0, g.cp1, g.cp2, g.p3, 0.5);
      pts.push({ type: "guide-body", edgeIdx: gi, pos: mid });
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
      const [mx, my] = toMaskFromPointer(e);

      if (guideAddMode) {
        onGuideAddClick(mx, my);
        return;
      }

      const canvas = canvasRef.current;
      if (canvas) canvas.setPointerCapture(e.pointerId);
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
        // Store offset: cursor position minus point position
        dragOffsetRef.current = [mx - bestPt.pos[0], my - bestPt.pos[1]];
        dragPosRef.current = maskToCanvas(bestPt.pos[0], bestPt.pos[1]);
        // For edge drag, store initial corner positions
        if (bestPt.type === "edge") {
          const si = bestPt.edgeIdx;
          const ei = (bestPt.edgeIdx + 1) % 4;
          edgeDragInitRef.current = {
            corners: [
              [...editState.corners[si]] as [number, number],
              [...editState.corners[ei]] as [number, number],
            ],
            midpoint: [...bestPt.pos] as [number, number],
          };
        } else {
          edgeDragInitRef.current = null;
        }
        // Place loupe at diagonal opposite corner
        const left = mx < maskWidth / 2;
        const top = my < maskHeight / 2;
        setLoupeCorner(left ? (top ? "br" : "tr") : top ? "bl" : "tl");
      } else {
        setSelected(null);
      }
    },
    [editState, selectedImage, toMaskFromPointer, getAllPoints, getScale, imgW, maskWidth, maskHeight, maskToCanvas, guideAddMode, onGuideAddClick],
  );

  // Clamp helpers: corners stay within image, CPs stay within container (padding area)
  const clampToImage = useCallback(
    (x: number, y: number): [number, number] => [
      Math.max(0, Math.min(maskWidth, x)),
      Math.max(0, Math.min(maskHeight, y)),
    ],
    [maskWidth, maskHeight],
  );
  const padMaskX = padX / (imgW / maskWidth);
  const padMaskY = padY / (imgH / maskHeight);
  const clampToContainer = useCallback(
    (x: number, y: number): [number, number] => [
      Math.max(-padMaskX, Math.min(maskWidth + padMaskX, x)),
      Math.max(-padMaskY, Math.min(maskHeight + padMaskY, y)),
    ],
    [maskWidth, maskHeight, padMaskX, padMaskY],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!dragging || !selected || !editState || !selectedImage) return;
      const [rawMx, rawMy] = toMaskFromPointer(e);
      // Apply offset so the point moves by delta, not snapping to cursor
      const mx = rawMx - dragOffsetRef.current[0];
      const my = rawMy - dragOffsetRef.current[1];

      if (!dragStartRef.current) {
        dispatch({ type: "PUSH_HISTORY", id: selectedImage.id });
        dragStartRef.current = true;
        onDragStart();
      }

      dragPosRef.current = maskToCanvas(mx, my);

      const { type, edgeIdx } = selected;
      if (type === "corner") {
        const corners = editState.corners.map((c) => [...c] as [number, number]);
        const [cx, cy] = clampToImage(mx, my);
        corners[edgeIdx] = [cx, cy];
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
      } else if (type === "edge") {
        const init = edgeDragInitRef.current;
        if (!init) return;
        // Top/bottom edges → vertical only; left/right → horizontal only
        const isVert = edgeIdx === 0 || edgeIdx === 2;
        const dx = isVert ? 0 : mx - init.midpoint[0];
        const dy = isVert ? my - init.midpoint[1] : 0;

        dragPosRef.current = maskToCanvas(init.midpoint[0] + dx, init.midpoint[1] + dy);

        const startIdx = edgeIdx;
        const endIdx = (edgeIdx + 1) % 4;
        const corners = editState.corners.map((c) => [...c] as [number, number]);
        corners[startIdx] = clampToImage(init.corners[0][0] + dx, init.corners[0][1] + dy);
        corners[endIdx] = clampToImage(init.corners[1][0] + dx, init.corners[1][1] + dy);

        const edgeFits = editState.edgeFits.map((f) => ({
          cp1: [...f.cp1] as [number, number],
          cp2: [...f.cp2] as [number, number],
          isArc: f.isArc,
        }));
        // Recalc CPs for all straight edges adjacent to both moved corners
        const affected = new Set([startIdx, (startIdx + 3) % 4, endIdx, (endIdx + 3) % 4]);
        for (const adj of affected) {
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
      } else if (type === "cp1" || type === "cp2") {
        const edgeFits = editState.edgeFits.map((f) => ({
          cp1: [...f.cp1] as [number, number],
          cp2: [...f.cp2] as [number, number],
          isArc: f.isArc,
        }));
        edgeFits[edgeIdx][type] = clampToContainer(mx, my);
        dispatch({
          type: "SET_EDIT_STATE",
          id: selectedImage.id,
          editState: { ...editState, edgeFits },
        });
      } else if (type === "guide-body") {
        // Move entire guide line by delta (translate all 4 points)
        const gi = edgeIdx;
        const g = editState.guideLines[gi];
        const midY = (g.p0[1] + g.p3[1]) / 2;
        const dy = my - midY;
        const dx = mx - (g.p0[0] + g.p3[0]) / 2;
        const guideLines = editState.guideLines.map((gl, i) => i === gi ? {
          p0: [g.p0[0] + dx, g.p0[1] + dy] as [number, number],
          p3: [g.p3[0] + dx, g.p3[1] + dy] as [number, number],
          cp1: [g.cp1[0] + dx, g.cp1[1] + dy] as [number, number],
          cp2: [g.cp2[0] + dx, g.cp2[1] + dy] as [number, number],
        } : { ...gl });
        dispatch({ type: "SET_EDIT_STATE", id: selectedImage.id, editState: { ...editState, guideLines } });
      } else if (type === "guide-left" || type === "guide-right") {
        // Freely drag endpoint (not constrained to edge)
        const gi = edgeIdx;
        const g = editState.guideLines[gi];
        const clamped = clampToContainer(mx, my);
        const guideLines = editState.guideLines.map((gl, i) => {
          if (i !== gi) return { ...gl };
          return type === "guide-left" ? { ...gl, p0: clamped } : { ...gl, p3: clamped };
        });
        dispatch({ type: "SET_EDIT_STATE", id: selectedImage.id, editState: { ...editState, guideLines } });
      } else if (type === "guide-cp1" || type === "guide-cp2") {
        const gi = edgeIdx;
        const cpKey = type === "guide-cp1" ? "cp1" : "cp2";
        const guideLines = editState.guideLines.map((gl, i) => {
          if (i !== gi) return { ...gl };
          return { ...gl, [cpKey]: clampToContainer(mx, my) };
        });
        dispatch({ type: "SET_EDIT_STATE", id: selectedImage.id, editState: { ...editState, guideLines } });
      }
    },
    [dragging, selected, editState, selectedImage, toMaskFromPointer, dispatch, onDragStart, maskToCanvas, clampToImage, clampToContainer],
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
        style={{
          cursor: guideAddMode
            ? "crosshair"
            : dragging
              ? selected?.type === "edge"
                ? (selected.edgeIdx === 0 || selected.edgeIdx === 2 ? "ns-resize" : "ew-resize")
                : "grabbing"
              : "pointer",
          aspectRatio: `${canW} / ${canH}`, touchAction: "none",
        }}
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
