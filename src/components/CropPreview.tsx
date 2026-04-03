"use client";

import { useRef, useEffect } from "react";
import { useApp } from "../context/AppContext";
import { rotateCanvas } from "../lib/crop";

export default function CropPreview() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { state } = useApp();
  const selectedImage = state.images.find(
    (img) => img.id === state.selectedImageId,
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const cropCanvas = selectedImage?.cropCanvas;
    const rotation = selectedImage?.editState?.rotation ?? 0;

    if (!cropCanvas) {
      // Show original if no crop, or clear
      if (selectedImage?.originalCanvas) {
        const src = selectedImage.originalCanvas;
        const maxDim = 600;
        const scale = Math.min(
          maxDim / src.width,
          maxDim / src.height,
          1,
        );
        canvas.width = Math.round(src.width * scale);
        canvas.height = Math.round(src.height * scale);
        canvas
          .getContext("2d")!
          .drawImage(src, 0, 0, canvas.width, canvas.height);
      } else {
        canvas.width = 1;
        canvas.height = 1;
      }
      return;
    }

    const rotated = rotateCanvas(cropCanvas, rotation);
    canvas.width = rotated.width;
    canvas.height = rotated.height;
    canvas.getContext("2d")!.drawImage(rotated, 0, 0);
  }, [
    selectedImage?.cropCanvas,
    selectedImage?.editState?.rotation,
    selectedImage?.originalCanvas,
  ]);

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
    <div className="flex-1 flex items-center justify-center p-4 bg-[var(--bg-secondary)] overflow-hidden">
      <canvas
        ref={canvasRef}
        className="max-w-full max-h-full object-contain"
      />
    </div>
  );
}
