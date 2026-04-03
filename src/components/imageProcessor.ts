import type { Dispatch } from "react";
import type { AppAction } from "../context/AppContext";
import { editStateFromQuad } from "../context/AppContext";
import type { ImageEntry } from "../lib/types";
import { loadModel, runInference } from "../lib/segmentation";
import { findQuadrilateral } from "../lib/quad";
import { perspectiveCrop } from "../lib/crop";

function createImageEntry(file: File): ImageEntry {
  return {
    id: crypto.randomUUID(),
    file,
    fileName: file.name,
    originalCanvas: null,
    mask: null,
    maskWidth: 0,
    maskHeight: 0,
    initialQuad: null,
    editState: null,
    history: { past: [], future: [] },
    cropCanvas: null,
    status: "pending",
  };
}

async function loadImageAsCanvas(file: File): Promise<HTMLCanvasElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(img, 0, 0);
      URL.revokeObjectURL(url);
      resolve(canvas);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error(`Failed to load ${file.name}`));
    };
    img.src = url;
  });
}

export async function processImages(
  files: File[],
  dispatch: Dispatch<AppAction>,
  currentSelectedId?: string | null,
): Promise<void> {
  // Ensure model is loaded
  dispatch({ type: "MODEL_LOADING" });
  await loadModel();
  dispatch({ type: "MODEL_LOADED" });

  for (const file of files) {
    const entry = createImageEntry(file);
    dispatch({ type: "ADD_IMAGE", entry });

    // Auto-select first image only if nothing is currently selected
    if (!currentSelectedId && files.indexOf(file) === 0) {
      dispatch({ type: "SELECT_IMAGE", id: entry.id });
    }

    dispatch({
      type: "UPDATE_IMAGE",
      id: entry.id,
      updates: { status: "processing" },
    });

    try {
      const originalCanvas = await loadImageAsCanvas(file);
      const { mask, width, height } = await runInference(originalCanvas);
      const quadResult = findQuadrilateral(mask, width, height);

      const editState = quadResult ? editStateFromQuad(quadResult) : null;
      let cropCanvas: HTMLCanvasElement | null = null;
      if (quadResult) {
        cropCanvas = perspectiveCrop(
          originalCanvas,
          quadResult,
          width,
          height,
        );
      }

      dispatch({
        type: "UPDATE_IMAGE",
        id: entry.id,
        updates: {
          originalCanvas,
          mask,
          maskWidth: width,
          maskHeight: height,
          initialQuad: quadResult,
          editState,
          cropCanvas,
          status: "ready",
        },
      });
    } catch (err) {
      dispatch({
        type: "UPDATE_IMAGE",
        id: entry.id,
        updates: {
          status: "error",
          error: err instanceof Error ? err.message : String(err),
        },
      });
    }
  }
}
