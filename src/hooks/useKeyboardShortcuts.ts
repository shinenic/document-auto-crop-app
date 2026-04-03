"use client";

import { useEffect } from "react";
import { useApp } from "../context/AppContext";
import { rotateCanvas } from "../lib/crop";

export function useKeyboardShortcuts() {
  const { state, dispatch } = useApp();

  useEffect(() => {
    if (state.screen !== "editor") return;

    const handler = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey;
      const shift = e.shiftKey;
      const selectedImage = state.images.find(
        (img) => img.id === state.selectedImageId,
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

      // Navigate images: ArrowUp / ArrowDown
      if (e.key === "ArrowUp" || e.key === "ArrowDown") {
        e.preventDefault();
        const idx = state.images.findIndex(
          (img) => img.id === state.selectedImageId,
        );
        const newIdx =
          e.key === "ArrowUp"
            ? Math.max(0, idx - 1)
            : Math.min(state.images.length - 1, idx + 1);
        if (newIdx !== idx) {
          dispatch({
            type: "SELECT_IMAGE",
            id: state.images[newIdx].id,
          });
        }
        return;
      }

      // Export: Ctrl+S
      if (meta && !shift && e.key === "s") {
        e.preventDefault();
        if (selectedImage?.cropCanvas) {
          const filterType = selectedImage.editState?.filterConfig?.type ?? "none";
          const sourceCanvas =
            filterType !== "none" && selectedImage.filteredCanvas
              ? selectedImage.filteredCanvas
              : selectedImage.cropCanvas;
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
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [state, dispatch]);
}
