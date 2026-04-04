"use client";

import { useRef, useEffect, useCallback, useState } from "react";
import { useApp } from "../context/AppContext";
import { rotateCanvas } from "../lib/crop";

const LOUPE_CSS = 260;
const LOUPE_ZOOM = 2.5;
const LOUPE_OFFSET = 24;

/**
 * Progressive downscale: halve the image in steps until close to target size,
 * then do a final drawImage to exact dimensions.
 */
function drawProgressive(
  ctx: CanvasRenderingContext2D,
  source: HTMLCanvasElement | OffscreenCanvas,
  dstW: number,
  dstH: number,
) {
  let current: HTMLCanvasElement | OffscreenCanvas = source;
  let curW = source.width;
  let curH = source.height;

  while (curW > dstW * 2 || curH > dstH * 2) {
    const halfW = Math.max(Math.round(curW / 2), dstW);
    const halfH = Math.max(Math.round(curH / 2), dstH);
    const tmp = new OffscreenCanvas(halfW, halfH);
    const tCtx = tmp.getContext("2d")!;
    tCtx.imageSmoothingEnabled = true;
    tCtx.imageSmoothingQuality = "high";
    tCtx.drawImage(current, 0, 0, halfW, halfH);
    current = tmp;
    curW = halfW;
    curH = halfH;
  }

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(current, 0, 0, dstW, dstH);
}

export default function CropPreview({
  eraserActive = false,
  eraserTool = "brush",
  brushSize = 20,
}: {
  eraserActive?: boolean;
  eraserTool?: "brush" | "lasso";
  brushSize?: number;
} = {}) {
  const { state } = useApp();
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const loupeRef = useRef<HTMLCanvasElement>(null);
  const drawRef = useRef<() => void>(() => {});

  // Full-res source for loupe sampling
  const sourceRef = useRef<HTMLCanvasElement | null>(null);
  // CSS display size → source pixel mapping
  const scaleInfoRef = useRef<{ cssW: number; cssH: number; srcW: number; srcH: number } | null>(null);

  const [loupeVisible, setLoupeVisible] = useState(false);

  const selectedImage = state.images.find(
    (img) => img.id === state.selectedImageId,
  );

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

    const sourceCanvas =
      filterType !== "none" && filteredCanvas ? filteredCanvas : cropCanvas;

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

    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    drawProgressive(ctx, rotated, canvas.width, canvas.height);
  }, [
    selectedImage?.cropCanvas,
    selectedImage?.filteredCanvas,
    selectedImage?.editState?.rotation,
    selectedImage?.editState?.filterConfig?.type,
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

  // Mouse handlers — direct DOM manipulation for 60fps loupe tracking
  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!loupeVisible) setLoupeVisible(true);
      drawLoupe(e.clientX, e.clientY);
    },
    [loupeVisible, drawLoupe],
  );

  const handleMouseLeave = useCallback(() => {
    setLoupeVisible(false);
  }, []);

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
      className="flex-1 flex items-center justify-center p-4 bg-[var(--bg-secondary)] overflow-hidden relative"
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
    >
      <canvas ref={canvasRef} />
      <canvas
        ref={loupeRef}
        className="pointer-events-none absolute rounded-full shadow-lg"
        style={{
          width: LOUPE_CSS,
          height: LOUPE_CSS,
          opacity: loupeVisible ? 1 : 0,
          transition: "opacity 150ms",
          border: "2px solid rgba(255,255,255,0.15)",
          background: "#111",
        }}
      />
    </div>
  );
}
