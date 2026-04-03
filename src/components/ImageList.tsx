"use client";

import { useEffect, useRef } from "react";
import { useApp } from "../context/AppContext";

function Thumbnail({
  id,
  originalCanvas,
  fileName,
  status,
  isSelected,
}: {
  id: string;
  originalCanvas: HTMLCanvasElement | null;
  fileName: string;
  status: string;
  isSelected: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const { dispatch } = useApp();

  useEffect(() => {
    if (isSelected && btnRef.current) {
      btnRef.current.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, [isSelected]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !originalCanvas) return;

    const maxDim = 120;
    const scale = Math.min(
      maxDim / originalCanvas.width,
      maxDim / originalCanvas.height,
    );
    canvas.width = Math.round(originalCanvas.width * scale);
    canvas.height = Math.round(originalCanvas.height * scale);

    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(originalCanvas, 0, 0, canvas.width, canvas.height);
  }, [originalCanvas]);

  return (
    <button
      ref={btnRef}
      className={`
        w-full p-1.5 rounded-lg transition-all duration-150
        ${
          isSelected
            ? "bg-[var(--accent-muted)] ring-1 ring-[var(--accent)]"
            : "hover:bg-[var(--bg-tertiary)]"
        }
      `}
      onClick={() => dispatch({ type: "SELECT_IMAGE", id })}
    >
      <div className="relative aspect-[4/3] rounded overflow-hidden bg-[var(--bg-tertiary)] flex items-center justify-center">
        {status === "processing" ? (
          <div className="w-5 h-5 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
        ) : status === "error" ? (
          <span className="text-xs text-[var(--danger)]">Error</span>
        ) : (
          <canvas
            ref={canvasRef}
            className="max-w-full max-h-full object-contain"
          />
        )}
      </div>
      <p className="text-[10px] text-[var(--text-muted)] mt-1 truncate">
        {fileName}
      </p>
    </button>
  );
}

export default function ImageList() {
  const { state } = useApp();

  return (
    <div className="w-28 flex-shrink-0 bg-[var(--bg-secondary)] border-r border-[var(--border)] overflow-y-auto p-2 flex flex-col gap-1">
      {state.images.map((img) => (
        <Thumbnail
          key={img.id}
          id={img.id}
          originalCanvas={img.originalCanvas}
          fileName={img.fileName}
          status={img.status}
          isSelected={img.id === state.selectedImageId}
        />
      ))}
    </div>
  );
}
