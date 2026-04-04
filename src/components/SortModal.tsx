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
  rectSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useApp } from "../context/AppContext";
import type { ImageEntry } from "../lib/types";

function SortableItem({
  image,
  index,
  onRemove,
}: {
  image: ImageEntry;
  index: number;
  onRemove: (id: string) => void;
}) {
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
    const maxDim = 220;
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
      className="relative group rounded-lg bg-[var(--bg-tertiary)] hover:bg-[var(--bg-elevated)] transition-colors overflow-hidden cursor-grab active:cursor-grabbing"
      {...attributes}
      {...listeners}
    >
      {/* Index badge */}
      <div className="absolute top-1.5 left-1.5 z-10 w-5 h-5 rounded-full bg-black/60 flex items-center justify-center">
        <span className="text-[10px] font-mono text-white">{index + 1}</span>
      </div>

      {/* Remove button */}
      <button
        className="absolute top-1.5 right-1.5 z-10 w-5 h-5 rounded-full bg-black/60 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-[var(--danger)]/80"
        onClick={(e) => {
          e.stopPropagation();
          onRemove(image.id);
        }}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <svg width="10" height="10" viewBox="0 0 10 10" fill="white">
          <path d="M2.146 2.146a.5.5 0 0 1 .708 0L5 4.293l2.146-2.147a.5.5 0 0 1 .708.708L5.707 5l2.147 2.146a.5.5 0 0 1-.708.708L5 5.707 2.854 7.854a.5.5 0 0 1-.708-.708L4.293 5 2.146 2.854a.5.5 0 0 1 0-.708z" />
        </svg>
      </button>

      {/* Thumbnail */}
      <div className="flex items-center justify-center p-2" style={{ minHeight: 400 }}>
        <canvas
          ref={canvasRef}
          className="max-w-full max-h-full object-contain"
        />
      </div>

      {/* Filename */}
      <div className="px-2 pb-2">
        <p className="text-[10px] text-[var(--text-muted)] truncate">
          {image.fileName}
        </p>
      </div>
    </div>
  );
}

export default function SortModal({ onClose }: { onClose: () => void }) {
  const { state, dispatch } = useApp();
  const [orderedIds, setOrderedIds] = useState(() =>
    state.images.map((img) => img.id),
  );

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      const oldIndex = orderedIds.indexOf(active.id as string);
      const newIndex = orderedIds.indexOf(over.id as string);
      const newIds = arrayMove(orderedIds, oldIndex, newIndex);
      setOrderedIds(newIds);
      dispatch({ type: "REORDER_IMAGES", orderedIds: newIds });
    }
  }, [dispatch, orderedIds]);

  const handleRemove = useCallback(
    (id: string) => {
      setOrderedIds((ids) => ids.filter((i) => i !== id));
      dispatch({ type: "REMOVE_IMAGE", id });
    },
    [dispatch],
  );

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

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
      <div className="bg-[var(--bg-secondary)] border border-[var(--border)] rounded-xl w-full max-w-5xl max-h-[85vh] flex flex-col shadow-2xl mx-4">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)]">
          <h3 className="text-sm font-medium text-[var(--text-primary)]">
            Manage Images
            <span className="ml-2 text-[var(--text-muted)] font-normal">
              {orderedImages.length} image{orderedImages.length !== 1 ? "s" : ""}
            </span>
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

        {/* Grid */}
        <div className="flex-1 overflow-y-auto p-4">
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={orderedIds}
              strategy={rectSortingStrategy}
            >
              <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] max-w-[960px] mx-auto gap-2">
                {orderedImages.map((img, i) => (
                  <SortableItem
                    key={img.id}
                    image={img}
                    index={i}
                    onRemove={handleRemove}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        </div>

      </div>
    </div>
  );
}
