"use client";

import { useRef, useEffect, useCallback } from "react";
import { useApp } from "../context/AppContext";
import { rotateCanvas } from "../lib/crop";

/**
 * Progressive downscale: halve the image in steps until close to target size,
 * then do a final drawImage to exact dimensions. Each bilinear 2x step
 * approximates area-average filtering, matching native Lanczos quality.
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

  // Step down by halves while source is more than 2x the target
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

  // Final step to exact target size
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(current, 0, 0, dstW, dstH);
}

export default function CropPreview() {
  const { state } = useApp();
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawRef = useRef<() => void>(() => {});

  const selectedImage = state.images.find(
    (img) => img.id === state.selectedImageId,
  );

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
      return;
    }

    const rotated =
      rotation !== 0 && sourceCanvas
        ? rotateCanvas(sourceCanvas, rotation)
        : displayCanvas;

    const srcW = rotated.width;
    const srcH = rotated.height;

    // Fit source into container (object-contain logic)
    const pad = 32; // 16px padding on each side (p-4)
    const availW = rect.width - pad;
    const availH = rect.height - pad;
    if (availW <= 0 || availH <= 0) return;

    const scale = Math.min(availW / srcW, availH / srcH, 1);
    const cssW = Math.round(srcW * scale);
    const cssH = Math.round(srcH * scale);

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

  // Keep drawRef current for ResizeObserver callback
  drawRef.current = draw;

  // Redraw when image data changes
  useEffect(() => {
    draw();
  }, [draw]);

  // Redraw when container resizes (reads DOM directly, no state needed)
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => drawRef.current());
    ro.observe(el);
    return () => ro.disconnect();
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
      className="flex-1 flex items-center justify-center p-4 bg-[var(--bg-secondary)] overflow-hidden"
    >
      <canvas ref={canvasRef} />
    </div>
  );
}
