"use client";

import { useCallback, useEffect, useState, useRef } from "react";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useApp } from "../context/AppContext";
import type { ImageEntry } from "../lib/types";

function SortableItem({ image, index }: { image: ImageEntry; index: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: image.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    const source = image.cropCanvas ?? image.originalCanvas;
    if (!canvas || !source) return;
    const maxDim = 80;
    const scale = Math.min(maxDim / source.width, maxDim / source.height);
    canvas.width = Math.round(source.width * scale);
    canvas.height = Math.round(source.height * scale);
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  }, [image.cropCanvas, image.originalCanvas]);

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-3 px-3 py-2 rounded-lg bg-[var(--bg-tertiary)] hover:bg-[var(--bg-elevated)] transition-colors"
    >
      <button
        className="cursor-grab active:cursor-grabbing text-[var(--text-muted)] hover:text-[var(--text-secondary)] shrink-0"
        {...attributes}
        {...listeners}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
          <circle cx="5" cy="3" r="1.5" />
          <circle cx="11" cy="3" r="1.5" />
          <circle cx="5" cy="8" r="1.5" />
          <circle cx="11" cy="8" r="1.5" />
          <circle cx="5" cy="13" r="1.5" />
          <circle cx="11" cy="13" r="1.5" />
        </svg>
      </button>
      <span className="text-xs text-[var(--text-muted)] w-6 shrink-0 font-mono">
        {index + 1}
      </span>
      <div className="w-16 h-12 rounded overflow-hidden bg-[var(--bg-secondary)] flex items-center justify-center shrink-0">
        <canvas ref={canvasRef} className="max-w-full max-h-full object-contain" />
      </div>
      <span className="text-xs text-[var(--text-secondary)] truncate flex-1">
        {image.fileName}
      </span>
      <span className="text-[10px] text-[var(--text-muted)] shrink-0">
        {image.status === "ready" ? "Ready" : image.status}
      </span>
    </div>
  );
}

export default function SortModal({ onClose }: { onClose: () => void }) {
  const { state, dispatch } = useApp();
  const [orderedIds, setOrderedIds] = useState(() =>
    state.images.map((img) => img.id),
  );

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (over && active.id !== over.id) {
        setOrderedIds((ids) => {
          const oldIndex = ids.indexOf(active.id as string);
          const newIndex = ids.indexOf(over.id as string);
          return arrayMove(ids, oldIndex, newIndex);
        });
      }
    },
    [],
  );

  const handleApply = useCallback(() => {
    dispatch({ type: "REORDER_IMAGES", orderedIds });
    onClose();
  }, [dispatch, orderedIds, onClose]);

  // Close on Escape
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  // Build ordered images list
  const idMap = new Map(state.images.map((img) => [img.id, img]));
  const orderedImages = orderedIds
    .map((id) => idMap.get(id))
    .filter((img): img is ImageEntry => img != null);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-[var(--bg-secondary)] border border-[var(--border)] rounded-xl w-full max-w-md max-h-[80vh] flex flex-col shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)]">
          <h3 className="text-sm font-medium text-[var(--text-primary)]">
            Reorder Images
          </h3>
          <button
            className="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
            onClick={onClose}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
              <path d="M4.646 4.646a.5.5 0 0 1 .708 0L8 7.293l2.646-2.647a.5.5 0 0 1 .708.708L8.707 8l2.647 2.646a.5.5 0 0 1-.708.708L8 8.707l-2.646 2.647a.5.5 0 0 1-.708-.708L7.293 8 4.646 5.354a.5.5 0 0 1 0-.708z" />
            </svg>
          </button>
        </div>

        {/* Sortable list */}
        <div className="flex-1 overflow-y-auto p-3">
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={orderedIds}
              strategy={verticalListSortingStrategy}
            >
              <div className="flex flex-col gap-1.5">
                {orderedImages.map((img, i) => (
                  <SortableItem key={img.id} image={img} index={i} />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 px-4 py-3 border-t border-[var(--border)]">
          <button
            className="px-3 py-1.5 text-xs font-medium rounded-lg bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)] transition-colors"
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            className="px-3 py-1.5 text-xs font-medium rounded-lg bg-[var(--accent)] text-[var(--bg-primary)] hover:bg-[var(--accent-hover)] transition-colors"
            onClick={handleApply}
          >
            Apply Order
          </button>
        </div>
      </div>
    </div>
  );
}
