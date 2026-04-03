"use client";

import { useCallback, useRef, useEffect } from "react";
import TopBar from "./TopBar";
import ImageList from "./ImageList";
import QuadEditor from "./QuadEditor";
import CropPreview from "./CropPreview";
import ToolPanel from "./ToolPanel";
import { useApp } from "../context/AppContext";
import { perspectiveCrop } from "../lib/crop";
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

  // Recompute full-res crop when editState changes (undo/redo/rotate/toggle)
  const selectedImage = getSelectedImage(state);
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

  return (
    <div className="h-dvh flex flex-col">
      <TopBar />
      <div className="flex-1 flex min-h-0">
        <ImageList />
        <div className="flex-1 flex min-w-0">
          <div className="flex-1 border-r border-[var(--border)] flex flex-col min-w-0">
            <div className="px-3 py-2 border-b border-[var(--border)]">
              <h4 className="text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
                Original + Editor
              </h4>
            </div>
            <QuadEditor
              onDragStart={handleDragStart}
              onDragEnd={handleDragEnd}
            />
          </div>
          <div className="flex-1 flex flex-col min-w-0">
            <div className="px-3 py-2 border-b border-[var(--border)]">
              <h4 className="text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
                Crop Preview
              </h4>
            </div>
            <CropPreview />
          </div>
        </div>
        <ToolPanel />
      </div>
    </div>
  );
}
