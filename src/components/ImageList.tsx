"use client";

import { useEffect, useRef } from "react";
import { useApp } from "../context/AppContext";
import { rotateCanvas } from "../lib/crop";
import type { EditState } from "../lib/types";

function Thumbnail({
  id,
  originalCanvas,
  cropCanvas,
  filteredCanvas,
  editState,
  fileName,
  status,
  isSelected,
}: {
  id: string;
  originalCanvas: HTMLCanvasElement | null;
  cropCanvas: HTMLCanvasElement | null;
  filteredCanvas: HTMLCanvasElement | null;
  editState: EditState | null;
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
    if (!canvas) return;

    // Choose source: filtered > crop > original; cancelled crop (editState=null) reverts to original
    let source: HTMLCanvasElement | null = null;
    let needsRotation = false;

    if (editState && filteredCanvas && editState.filterConfig.type !== "none") {
      source = filteredCanvas;
      needsRotation = true;
    } else if (editState && cropCanvas) {
      source = cropCanvas;
      needsRotation = true;
    } else {
      source = originalCanvas;
    }

    if (!source) return;

    // Apply rotation when showing crop/filtered preview
    const display =
      needsRotation && editState && editState.rotation !== 0
        ? rotateCanvas(source, editState.rotation)
        : source;

    const maxDim = 120;
    const scale = Math.min(
      maxDim / display.width,
      maxDim / display.height,
    );
    canvas.width = Math.round(display.width * scale);
    canvas.height = Math.round(display.height * scale);

    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(display, 0, 0, canvas.width, canvas.height);
  }, [originalCanvas, cropCanvas, filteredCanvas, editState]);

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
    <div className="flex-1 bg-[var(--bg-secondary)] border-r border-[var(--border)] overflow-y-auto p-2 flex flex-col gap-1">
      {state.images.map((img) => (
        <Thumbnail
          key={img.id}
          id={img.id}
          originalCanvas={img.originalCanvas}
          cropCanvas={img.cropCanvas}
          filteredCanvas={img.filteredCanvas}
          editState={img.editState}
          fileName={img.fileName}
          status={img.status}
          isSelected={img.id === state.selectedImageId}
        />
      ))}
    </div>
  );
}
