"use client";

import { useEffect, useRef, useState } from "react";
import { useApp } from "../context/AppContext";
import { rotateCanvas } from "../lib/crop";
import { drawProgressive } from "../lib/drawProgressive";
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
  containerWidth,
}: {
  id: string;
  originalCanvas: HTMLCanvasElement | null;
  cropCanvas: HTMLCanvasElement | null;
  filteredCanvas: HTMLCanvasElement | null;
  editState: EditState | null;
  fileName: string;
  status: string;
  isSelected: boolean;
  containerWidth: number;
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

    const display =
      needsRotation && editState && editState.rotation !== 0
        ? rotateCanvas(source, editState.rotation)
        : source;

    // Scale based on container width with DPR for crisp rendering
    const dpr = window.devicePixelRatio || 1;
    const maxW = Math.max(containerWidth - 20, 40);
    const maxH = maxW * 0.75;
    const scale = Math.min(maxW / display.width, maxH / display.height);
    const cssW = Math.round(display.width * scale);
    const cssH = Math.round(display.height * scale);
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    canvas.style.width = `${cssW}px`;
    canvas.style.height = `${cssH}px`;

    const ctx = canvas.getContext("2d")!;
    drawProgressive(ctx, display, canvas.width, canvas.height);
  }, [originalCanvas, cropCanvas, filteredCanvas, editState, containerWidth]);

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
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(112);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      setContainerWidth(entries[0].contentRect.width);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div
      ref={containerRef}
      className="flex-1 bg-[var(--bg-secondary)] overflow-y-auto p-2 flex flex-col gap-1"
    >
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
          containerWidth={containerWidth}
        />
      ))}
    </div>
  );
}
