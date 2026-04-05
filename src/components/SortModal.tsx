"use client";

import { useCallback, useEffect, useState, useRef } from "react";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragOverlay,
  type DragStartEvent,
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
import { drawProgressive } from "../lib/drawProgressive";
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
    const dpr = window.devicePixelRatio || 1;
    const maxDim = 300;
    const scale = Math.min(maxDim / source.width, maxDim / source.height);
    const cssW = Math.round(source.width * scale);
    const cssH = Math.round(source.height * scale);
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    canvas.style.width = `${cssW}px`;
    canvas.style.height = `${cssH}px`;
    const ctx = canvas.getContext("2d")!;
    drawProgressive(ctx, source, canvas.width, canvas.height);
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

      {/* Remove button — always visible */}
      <button
        className="absolute top-1.5 right-1.5 z-10 w-6 h-6 rounded-md bg-[var(--danger)]/70 hover:bg-[var(--danger)] flex items-center justify-center transition-colors shadow-sm"
        onClick={(e) => {
          e.stopPropagation();
          onRemove(image.id);
        }}
        onPointerDown={(e) => e.stopPropagation()}
        title="Remove image"
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
          <path d="M18 6L6 18M6 6l12 12" />
        </svg>
      </button>

      {/* Thumbnail */}
      <div className="flex items-center justify-center p-1" style={{ minHeight: 336 }}>
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
  const [activeId, setActiveId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  // Focus trap and restore focus on close
  useEffect(() => {
    previousFocusRef.current = document.activeElement as HTMLElement;
    dialogRef.current?.focus();
    return () => { previousFocusRef.current?.focus(); };
  }, []);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveId(event.active.id as string);
  }, []);

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    setActiveId(null);
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
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="sort-modal-title"
        tabIndex={-1}
        className="bg-[var(--bg-secondary)] border border-[var(--border)] rounded-xl w-full max-w-5xl flex flex-col shadow-2xl mx-4 outline-none"
        style={{ maxHeight: "calc(100vh - 80px)" }}
        onKeyDown={(e) => {
          if (e.key === "Tab") {
            const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
              'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
            );
            if (!focusable || focusable.length === 0) return;
            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            if (e.shiftKey && document.activeElement === first) {
              e.preventDefault();
              last.focus();
            } else if (!e.shiftKey && document.activeElement === last) {
              e.preventDefault();
              first.focus();
            }
          }
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)]">
          <div>
            <h3 id="sort-modal-title" className="text-sm font-medium text-[var(--text-primary)]">
              Manage Images
              <span className="ml-2 text-[var(--text-muted)] font-normal">
                {orderedImages.length} image{orderedImages.length !== 1 ? "s" : ""}
              </span>
            </h3>
            <p className="text-[10px] text-[var(--text-muted)] mt-0.5">
              Drag to reorder &middot; Click <span className="text-[var(--danger)]">X</span> to remove
            </p>
          </div>
          <button
            className="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
            onClick={onClose}
            aria-label="Close"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
              <path d="M4.646 4.646a.5.5 0 0 1 .708 0L8 7.293l2.646-2.647a.5.5 0 0 1 .708.708L8.707 8l2.647 2.646a.5.5 0 0 1-.708.708L8 8.707l-2.646 2.647a.5.5 0 0 1-.708-.708L7.293 8 4.646 5.354a.5.5 0 0 1 0-.708z" />
            </svg>
          </button>
        </div>

        {/* Grid */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto p-4">
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
            onDragCancel={() => setActiveId(null)}
            autoScroll={{ layoutShiftCompensation: false, acceleration: 15, interval: 10 }}
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
            <DragOverlay dropAnimation={null}>
              {activeId ? (() => {
                const idx = orderedIds.indexOf(activeId);
                const img = idMap.get(activeId);
                if (!img) return null;
                // Generate a small data URL for the overlay thumbnail
                const src = img.cropCanvas ?? img.originalCanvas;
                let dataUrl = "";
                if (src) {
                  const tmp = document.createElement("canvas");
                  const scale = Math.min(200 / src.width, 180 / src.height);
                  tmp.width = Math.round(src.width * scale);
                  tmp.height = Math.round(src.height * scale);
                  const tCtx = tmp.getContext("2d");
                  if (tCtx) { tCtx.drawImage(src, 0, 0, tmp.width, tmp.height); dataUrl = tmp.toDataURL("image/jpeg", 0.6); }
                }
                return (
                  <div className="relative rounded-lg bg-[var(--bg-elevated)] shadow-2xl opacity-90 border border-[var(--accent)]/40 overflow-hidden" style={{ width: 220 }}>
                    <div className="absolute top-1.5 left-1.5 z-10 w-5 h-5 rounded-full bg-black/60 flex items-center justify-center">
                      <span className="text-[10px] font-mono text-white">{idx + 1}</span>
                    </div>
                    <div className="flex items-center justify-center p-1" style={{ minHeight: 180 }}>
                      {dataUrl && <img src={dataUrl} alt="" className="max-w-full max-h-[180px] object-contain" />}
                    </div>
                    <div className="px-2 pb-2">
                      <p className="text-[10px] text-[var(--text-muted)] truncate">{img.fileName}</p>
                    </div>
                  </div>
                );
              })() : null}
            </DragOverlay>
          </DndContext>
        </div>

      </div>
    </div>
  );
}
