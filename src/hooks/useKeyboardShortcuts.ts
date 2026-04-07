"use client";

import { useEffect, useRef } from "react";
import { useApp } from "../context/AppContext";
import { useDraft } from "../context/DraftContext";
import { rotateCanvas } from "../lib/crop";
import { applyEraseMask } from "../lib/eraser";
import type { AppState } from "../lib/types";

export function useKeyboardShortcuts() {
  const { state, dispatch } = useApp();
  const draft = useDraft();
  const stateRef = useRef<AppState>(state);
  useEffect(() => { stateRef.current = state; });

  useEffect(() => {
    if (state.screen !== "editor") return;

    const handler = (e: KeyboardEvent) => {
      const s = stateRef.current;
      const meta = e.metaKey || e.ctrlKey;
      const shift = e.shiftKey;
      const selectedImage = s.images.find(
        (img) => img.id === s.selectedImageId,
      );
      const id = selectedImage?.id;
      if (!id) return;

      // Undo: Ctrl+Z
      if (meta && !shift && e.key === "z") {
        e.preventDefault();
        dispatch({ type: "UNDO", id });
        return;
      }

      // Redo: Ctrl+Shift+Z or Ctrl+Y
      if (
        (meta && shift && (e.key === "z" || e.key === "Z")) ||
        (meta && !shift && e.key === "y")
      ) {
        e.preventDefault();
        dispatch({ type: "REDO", id });
        return;
      }

      // Rotate CW: R
      if (
        !meta &&
        !shift &&
        e.key === "r" &&
        selectedImage?.editState
      ) {
        e.preventDefault();
        dispatch({ type: "PUSH_HISTORY", id });
        const r = selectedImage.editState.rotation;
        dispatch({
          type: "SET_EDIT_STATE",
          id,
          editState: {
            ...selectedImage.editState,
            rotation: ((r + 90) % 360) as 0 | 90 | 180 | 270,
          },
        });
        return;
      }

      // Rotate CCW: Shift+R
      if (
        !meta &&
        shift &&
        (e.key === "R" || e.key === "r") &&
        selectedImage?.editState
      ) {
        e.preventDefault();
        dispatch({ type: "PUSH_HISTORY", id });
        const r = selectedImage.editState.rotation;
        dispatch({
          type: "SET_EDIT_STATE",
          id,
          editState: {
            ...selectedImage.editState,
            rotation: ((r + 270) % 360) as 0 | 90 | 180 | 270,
          },
        });
        return;
      }

      // Save Draft: Ctrl+S
      if (meta && !shift && e.key === "s") {
        e.preventDefault();
        draft.save();
        return;
      }

      // Save Draft As: Ctrl+Shift+S
      if (meta && shift && (e.key === "s" || e.key === "S")) {
        e.preventDefault();
        draft.saveAs();
        return;
      }

      // Export JPEG: Ctrl+E
      if (meta && !shift && e.key === "e") {
        e.preventDefault();
        if (selectedImage?.cropCanvas) {
          const filterType = selectedImage.editState?.filterConfig?.type ?? "none";
          let sourceCanvas =
            filterType !== "none" && selectedImage.filteredCanvas
              ? selectedImage.filteredCanvas
              : selectedImage.cropCanvas;
          const eraseMask = selectedImage.editState?.eraseMask;
          if (eraseMask && sourceCanvas && filterType !== "none") {
            sourceCanvas = applyEraseMask(sourceCanvas, eraseMask);
          }
          const rotation = selectedImage.editState?.rotation ?? 0;
          const final = rotateCanvas(sourceCanvas, rotation);
          final.toBlob((blob: Blob | null) => {
            if (!blob) return;
            const url = URL.createObjectURL(blob);
            const link = document.createElement("a");
            link.download = `cropped-${selectedImage.fileName.replace(/\.[^.]+$/, "")}.jpg`;
            link.href = url;
            link.click();
            URL.revokeObjectURL(url);
          }, "image/jpeg", 0.92);
        }
        return;
      }

      // Open Draft: Ctrl+O
      if (meta && !shift && e.key === "o") {
        e.preventDefault();
        draft.openDraft();
        return;
      }

      // Navigate images: ArrowUp / ArrowDown
      if (e.key === "ArrowUp" || e.key === "ArrowDown") {
        e.preventDefault();
        const idx = s.images.findIndex(
          (img) => img.id === s.selectedImageId,
        );
        const newIdx =
          e.key === "ArrowUp"
            ? Math.max(0, idx - 1)
            : Math.min(s.images.length - 1, idx + 1);
        if (newIdx !== idx) {
          dispatch({
            type: "SELECT_IMAGE",
            id: s.images[newIdx].id,
          });
        }
        return;
      }

    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [state.screen, dispatch, draft]);
}
