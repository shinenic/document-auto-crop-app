"use client";

import { useCallback, useRef, useEffect, useState } from "react";
import TopBar from "./TopBar";
import ImageList from "./ImageList";
import SortModal from "./SortModal";
import QuadEditor from "./QuadEditor";
import CropPreview from "./CropPreview";
import ToolPanel from "./ToolPanel";
import { useApp } from "../context/AppContext";
import { perspectiveCrop } from "../lib/crop";
import { applyBinarize } from "../lib/binarize";
import type { AppState } from "../lib/types";
import { useKeyboardShortcuts } from "../hooks/useKeyboardShortcuts";

function getSelectedImage(state: AppState) {
  return state.images.find((img) => img.id === state.selectedImageId);
}

export default function EditorScreen() {
  const { state, dispatch } = useApp();
  const prevCropKeyRef = useRef<string | null>(null);
  const isDraggingRef = useRef(false);
  const stateRef = useRef(state);
  stateRef.current = state;

  useKeyboardShortcuts();
  const [sortModalOpen, setSortModalOpen] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(200);
  const resizingRef = useRef(false);

  const [eraserActive, setEraserActive] = useState(false);
  const [eraserTool, setEraserTool] = useState<"brush" | "lasso">("brush");
  const [brushSize, setBrushSize] = useState(20);

  // Exit eraser mode when switching images
  useEffect(() => {
    setEraserActive(false);
  }, [state.selectedImageId]);

  // Eraser hotkeys: E=toggle, B=brush, L=lasso, [/]=brush size
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;

      const img = getSelectedImage(stateRef.current);
      const isBW = img?.editState?.filterConfig?.type === "binarize" && !!img.filteredCanvas;

      if (e.key === "Escape" && eraserActive) {
        e.preventDefault();
        setEraserActive(false);
        return;
      }
      if (e.key.toLowerCase() === "e" && isBW) {
        e.preventDefault();
        setEraserActive((v) => !v);
        return;
      }
      if (eraserActive) {
        if (e.key.toLowerCase() === "b") {
          e.preventDefault();
          setEraserTool("brush");
          return;
        }
        if (e.key.toLowerCase() === "l") {
          e.preventDefault();
          setEraserTool("lasso");
          return;
        }
        if (e.key === "[") {
          e.preventDefault();
          setBrushSize((s) => Math.max(5, s - 5));
          return;
        }
        if (e.key === "]") {
          e.preventDefault();
          setBrushSize((s) => Math.min(100, s + 5));
          return;
        }
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [eraserActive]);

  const selectedImage = getSelectedImage(state);

  // Clear eraseMask when filteredCanvas dimensions change (crop geometry changed)
  useEffect(() => {
    if (!selectedImage?.editState?.eraseMask || !selectedImage.filteredCanvas) return;
    const mask = selectedImage.editState.eraseMask;
    const fc = selectedImage.filteredCanvas;
    if (mask.width !== fc.width || mask.height !== fc.height) {
      dispatch({
        type: "SET_EDIT_STATE",
        id: selectedImage.id,
        editState: { ...selectedImage.editState, eraseMask: null },
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedImage?.filteredCanvas]);

  // Recompute full-res crop when editState changes (undo/redo/rotate/toggle)
  const cropKey = selectedImage?.editState
    ? JSON.stringify({
        corners: selectedImage.editState.corners,
        edgeFits: selectedImage.editState.edgeFits,
      })
    : null;

  useEffect(() => {
    if (isDraggingRef.current) return;
    if (!selectedImage?.editState || !selectedImage.originalCanvas)
      return;
    if (cropKey === prevCropKeyRef.current) return;
    prevCropKeyRef.current = cropKey;

    const quadResult = {
      corners: selectedImage.editState.corners,
      edges: selectedImage.initialQuad?.edges ?? [],
      edgeFits: selectedImage.editState.edgeFits,
    };

    const cropCanvas = perspectiveCrop(
      selectedImage.originalCanvas,
      quadResult,
      selectedImage.maskWidth,
      selectedImage.maskHeight,
    );

    dispatch({
      type: "UPDATE_IMAGE",
      id: selectedImage.id,
      updates: { cropCanvas },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cropKey, state.selectedImageId]);

  // Compute filteredCanvas when cropCanvas or filterConfig changes
  const filterKey = selectedImage?.editState?.filterConfig
    ? JSON.stringify(selectedImage.editState.filterConfig)
    : null;

  useEffect(() => {
    if (!selectedImage?.cropCanvas || !selectedImage.editState) return;

    const { filterConfig } = selectedImage.editState;
    const imageId = selectedImage.id;
    const cropCanvas = selectedImage.cropCanvas;

    // If filter is none, clear filteredCanvas
    if (filterConfig.type === "none") {
      if (selectedImage.filteredCanvas) {
        dispatch({
          type: "UPDATE_IMAGE",
          id: imageId,
          updates: { filteredCanvas: null },
        });
      }
      return;
    }

    // Debounce: wait 200ms before computing
    let cancelled = false;
    const timer = setTimeout(() => {
      applyBinarize(cropCanvas, filterConfig.binarize).then(
        (filteredCanvas) => {
          if (!cancelled) {
            dispatch({
              type: "UPDATE_IMAGE",
              id: imageId,
              updates: { filteredCanvas },
            });
          }
        },
        (err) => {
          if (!cancelled) {
            console.error("Binarize filter failed:", err);
          }
        },
      );
    }, 200);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterKey, selectedImage?.cropCanvas, state.selectedImageId]);

  // Recompute filteredCanvas for non-selected images after batch filter.
  // Processes sequentially to avoid flooding the binarize worker.
  useEffect(() => {
    let cancelled = false;

    async function processBatch() {
      for (const img of state.images) {
        if (cancelled) break;
        if (img.id === state.selectedImageId) continue;
        if (!img.cropCanvas || !img.editState) continue;

        const { filterConfig } = img.editState;
        if (filterConfig.type === "none") {
          if (img.filteredCanvas) {
            dispatch({
              type: "UPDATE_IMAGE",
              id: img.id,
              updates: { filteredCanvas: null },
            });
          }
          continue;
        }

        if (!img.filteredCanvas) {
          try {
            const filteredCanvas = await applyBinarize(img.cropCanvas, filterConfig.binarize);
            if (!cancelled) {
              dispatch({
                type: "UPDATE_IMAGE",
                id: img.id,
                updates: { filteredCanvas },
              });
            }
          } catch (err) {
            if (!cancelled) {
              console.error("Batch binarize failed for", img.id, err);
            }
          }
        }
      }
    }

    processBatch();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.images.map((img) => img.editState?.filterConfig?.type).join(",")]);

  const handleDragStart = useCallback(() => {
    isDraggingRef.current = true;
  }, []);

  // Full-res crop after drag ends
  const handleDragEnd = useCallback(() => {
    isDraggingRef.current = false;
    const img = getSelectedImage(stateRef.current);
    if (!img?.editState || !img.originalCanvas) return;

    const quadResult = {
      corners: img.editState.corners,
      edges: img.initialQuad?.edges ?? [],
      edgeFits: img.editState.edgeFits,
    };

    const cropCanvas = perspectiveCrop(
      img.originalCanvas,
      quadResult,
      img.maskWidth,
      img.maskHeight,
    );

    // Update prevCropKey so the useEffect doesn't double-compute
    prevCropKeyRef.current = JSON.stringify({
      corners: img.editState.corners,
      edgeFits: img.editState.edgeFits,
    });

    dispatch({
      type: "UPDATE_IMAGE",
      id: img.id,
      updates: { cropCanvas },
    });
  }, [dispatch]);

  const handleResizePointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    resizingRef.current = true;
    const startX = e.clientX;
    const startW = sidebarWidth;

    const onMove = (ev: PointerEvent) => {
      const delta = ev.clientX - startX;
      setSidebarWidth(Math.max(100, Math.min(480, startW + delta)));
    };

    const onUp = () => {
      resizingRef.current = false;
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }, [sidebarWidth]);

  return (
    <div className="h-dvh flex flex-col">
      <TopBar onManageImages={() => setSortModalOpen(true)} />
      <div className="flex-1 flex min-h-0">
        <div className="flex flex-col flex-shrink-0 relative border-r border-[var(--border)]" style={{ width: sidebarWidth }}>
          <ImageList />
          {/* Resize handle */}
          <div
            className="absolute top-0 right-0 w-1.5 h-full cursor-col-resize hover:bg-[var(--accent)]/30 active:bg-[var(--accent)]/50 transition-colors z-10"
            onPointerDown={handleResizePointerDown}
          />
        </div>
        <div className="flex-1 flex min-w-0">
          <div className="flex-1 border-r border-[var(--border)] flex flex-col min-w-0">
            <div className="px-3 py-1.5 border-b border-[var(--border)]">
              <h4 className="text-[9px] uppercase tracking-[0.1em] text-[var(--text-muted)] font-semibold">
                Editor
              </h4>
            </div>
            <QuadEditor
              onDragStart={handleDragStart}
              onDragEnd={handleDragEnd}
            />
          </div>
          <div className="flex-1 flex flex-col min-w-0">
            <div className="px-3 py-1.5 border-b border-[var(--border)]">
              <h4 className="text-[9px] uppercase tracking-[0.1em] text-[var(--text-muted)] font-semibold">
                Preview
              </h4>
            </div>
            <CropPreview
              eraserActive={eraserActive}
              eraserTool={eraserTool}
              brushSize={brushSize}
            />
          </div>
        </div>
        <ToolPanel
          eraserActive={eraserActive}
          onToggleEraser={() => setEraserActive((v) => !v)}
          eraserTool={eraserTool}
          onSetEraserTool={setEraserTool}
          brushSize={brushSize}
          onSetBrushSize={setBrushSize}
        />
      </div>
      {sortModalOpen && (
        <SortModal onClose={() => setSortModalOpen(false)} />
      )}
    </div>
  );
}
