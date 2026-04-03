"use client";

import { useRef, useEffect, useState } from "react";
import { useApp } from "../context/AppContext";
import { rotateCanvas } from "../lib/crop";

export default function CropPreview() {
  const { state } = useApp();
  const [imgSrc, setImgSrc] = useState<string | null>(null);
  const prevUrlRef = useRef<string | null>(null);

  const selectedImage = state.images.find(
    (img) => img.id === state.selectedImageId,
  );

  const isBinarized =
    (selectedImage?.editState?.filterConfig?.type ?? "none") !== "none" &&
    !!selectedImage?.filteredCanvas;

  useEffect(() => {
    const cropCanvas = selectedImage?.cropCanvas;
    const filteredCanvas = selectedImage?.filteredCanvas;
    const filterType = selectedImage?.editState?.filterConfig?.type ?? "none";
    const rotation = selectedImage?.editState?.rotation ?? 0;

    // Choose source: filteredCanvas if filter is active AND result is ready
    const sourceCanvas =
      filterType !== "none" && filteredCanvas ? filteredCanvas : cropCanvas;

    // Fallback to original when no crop
    const displayCanvas = sourceCanvas ?? selectedImage?.originalCanvas ?? null;

    if (!displayCanvas) {
      if (prevUrlRef.current) URL.revokeObjectURL(prevUrlRef.current);
      prevUrlRef.current = null;
      setImgSrc(null);
      return;
    }

    const rotated = rotation !== 0 && sourceCanvas
      ? rotateCanvas(sourceCanvas, rotation)
      : displayCanvas;

    // Convert canvas to blob URL for <img> rendering
    // Use PNG for binarized (lossless, preserves hard edges), JPEG for photos
    const mimeType = filterType !== "none" ? "image/png" : "image/jpeg";
    const quality = filterType !== "none" ? undefined : 0.92;

    rotated.toBlob(
      (blob) => {
        if (!blob) return;
        if (prevUrlRef.current) URL.revokeObjectURL(prevUrlRef.current);
        const url = URL.createObjectURL(blob);
        prevUrlRef.current = url;
        setImgSrc(url);
      },
      mimeType,
      quality,
    );

    // Cleanup on unmount
    return () => {
      // Don't revoke here — the next effect run or unmount cleanup handles it
    };
  }, [
    selectedImage?.cropCanvas,
    selectedImage?.filteredCanvas,
    selectedImage?.editState?.rotation,
    selectedImage?.editState?.filterConfig?.type,
    selectedImage?.originalCanvas,
  ]);

  // Revoke blob URL on unmount
  useEffect(() => {
    return () => {
      if (prevUrlRef.current) URL.revokeObjectURL(prevUrlRef.current);
    };
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
    <div className="flex-1 flex items-center justify-center p-4 bg-[var(--bg-secondary)] overflow-hidden">
      {imgSrc ? (
        <img
          src={imgSrc}
          alt="Crop preview"
          className="max-w-full max-h-full object-contain"
          style={isBinarized ? { imageRendering: "pixelated" } : undefined}
        />
      ) : (
        <p className="text-[var(--text-muted)] text-sm">No preview</p>
      )}
    </div>
  );
}
