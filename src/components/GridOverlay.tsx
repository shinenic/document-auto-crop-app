"use client";

import { useRef, useCallback } from "react";

export type GridMode = "grid" | "vertical" | "horizontal";

export const GRID_COLORS = [
  { label: "Red", value: "255, 80, 80" },
  { label: "Orange", value: "255, 160, 50" },
  { label: "Yellow", value: "255, 220, 50" },
  { label: "Green", value: "80, 220, 120" },
  { label: "Cyan", value: "80, 210, 255" },
  { label: "Blue", value: "100, 130, 255" },
  { label: "Purple", value: "180, 100, 255" },
  { label: "White", value: "255, 255, 255" },
] as const;

export interface GridConfig {
  enabled: boolean;
  mode: GridMode;
  spacing: number; // px between lines
  offset: { x: number; y: number };
  color: string; // r, g, b (no alpha)
  opacity: number; // 0-1
}

export const DEFAULT_GRID_CONFIG: GridConfig = {
  enabled: false,
  mode: "grid",
  spacing: 50,
  offset: { x: 0, y: 0 },
  color: "255, 80, 80",
  opacity: 0.6,
};

export default function GridOverlay({
  mode,
  spacing,
  offset,
  color,
  opacity,
  onOffsetChange,
}: {
  mode: GridMode;
  spacing: number;
  offset: { x: number; y: number };
  color: string;
  opacity: number;
  onOffsetChange: (offset: { x: number; y: number }) => void;
}) {
  const dragging = useRef(false);
  const lastPos = useRef({ x: 0, y: 0 });

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      dragging.current = true;
      lastPos.current = { x: e.clientX, y: e.clientY };
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    },
    [],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!dragging.current) return;
      const dx = e.clientX - lastPos.current.x;
      const dy = e.clientY - lastPos.current.y;
      lastPos.current = { x: e.clientX, y: e.clientY };
      // Normalize offset to stay within one spacing period
      const nx = ((offset.x + dx) % spacing + spacing) % spacing;
      const ny = ((offset.y + dy) % spacing + spacing) % spacing;
      onOffsetChange({ x: nx, y: ny });
    },
    [offset, spacing, onOffsetChange],
  );

  const handlePointerUp = useCallback(() => {
    dragging.current = false;
  }, []);

  const lineColor = `rgba(${color}, ${opacity})`;
  const backgrounds: string[] = [];
  const sizes: string[] = [];

  if (mode === "grid" || mode === "vertical") {
    backgrounds.push(`linear-gradient(to right, ${lineColor} 1px, transparent 1px)`);
    sizes.push(`${spacing}px 1px`);
  }
  if (mode === "grid" || mode === "horizontal") {
    backgrounds.push(`linear-gradient(to bottom, ${lineColor} 1px, transparent 1px)`);
    sizes.push(`1px ${spacing}px`);
  }

  return (
    <div
      className="absolute inset-0 z-10 cursor-grab active:cursor-grabbing"
      style={{
        backgroundImage: backgrounds.join(", "),
        backgroundSize: sizes.join(", "),
        backgroundPosition: `${offset.x}px ${offset.y}px`,
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
    />
  );
}
