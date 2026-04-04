"use client";

import { useRef, useEffect, useCallback, useState } from "react";
import { useApp } from "../context/AppContext";
import { rotateCanvas } from "../lib/crop";

export default function CropPreview() {
  const { state } = useApp();
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [containerSize, setContainerSize] = useState<{ w: number; h: number } | null>(null);

  const selectedImage = state.images.find(
    (img) => img.id === state.selectedImageId,
  );

  const isBinarized =
    (selectedImage?.editState?.filterConfig?.type ?? "none") !== "none" &&
    !!selectedImage?.filteredCanvas;

  // Track container size
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      setContainerSize({ w: width, h: height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Draw source canvas onto display canvas with DPR scaling
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !containerSize) return;

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
    const availW = containerSize.w - pad;
    const availH = containerSize.h - pad;
    const scale = Math.min(availW / srcW, availH / srcH, 1);
    const cssW = Math.round(srcW * scale);
    const cssH = Math.round(srcH * scale);

    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    canvas.style.width = `${cssW}px`;
    canvas.style.height = `${cssH}px`;

    const ctx = canvas.getContext("2d")!;
    if (isBinarized) {
      ctx.imageSmoothingEnabled = false;
    } else {
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
    }
    ctx.drawImage(rotated, 0, 0, canvas.width, canvas.height);
  }, [selectedImage, containerSize, isBinarized]);

  useEffect(() => {
    draw();
  }, [draw]);

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
