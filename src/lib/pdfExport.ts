/**
 * PDF Export service -- worker communication layer.
 * Manages the pdfExport web worker lifecycle and provides exportPdf().
 */
import type { ImageEntry } from "./types";
import { rotateCanvas } from "./crop";
import { applyEraseMask } from "./eraser";

// ---------------------------------------------------------------------------
// Page descriptor types (must match pdfExport.worker.ts protocol)
// ---------------------------------------------------------------------------

interface JpegPage {
  type: "jpeg";
  jpegBytes: ArrayBuffer;
  width: number;
  height: number;
}

interface BinarizePage {
  type: "binarize";
  rgbaBytes: ArrayBuffer;
  width: number;
  height: number;
  blockRadiusBps: number;
  contrastOffset: number;
  upsamplingScale: number;
}

type PageDescriptor = JpegPage | BinarizePage;

// ---------------------------------------------------------------------------
// Worker lifecycle (lazy init, same pattern as binarize.ts)
// ---------------------------------------------------------------------------

let worker: Worker | null = null;
let msgId = 0;
const pending = new Map<
  number,
  {
    resolve: (data: ArrayBuffer) => void;
    reject: (e: Error) => void;
  }
>();

function ensureWorker(): Worker {
  if (!worker) {
    worker = new Worker(
      new URL("./pdfExport.worker.ts", import.meta.url),
      { type: "module" },
    );
    worker.onmessage = (e: MessageEvent) => {
      const { id, ok, error, data } = e.data;
      const p = pending.get(id);
      if (!p) return;
      pending.delete(id);
      if (ok) p.resolve(data);
      else p.reject(new Error(error));
    };
    worker.onerror = (event) => {
      const msg = event.message || "PDF export worker error";
      for (const [, p] of pending) {
        p.reject(new Error(msg));
      }
      pending.clear();
    };
  }
  return worker;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Convert a canvas to a JPEG ArrayBuffer at the given quality.
 */
function canvasToJpegBytes(
  canvas: HTMLCanvasElement,
  quality: number,
): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error("Failed to create JPEG blob from canvas"));
          return;
        }
        blob.arrayBuffer().then(resolve, reject);
      },
      "image/jpeg",
      quality,
    );
  });
}

/**
 * Extract raw RGBA pixel data from a canvas.
 */
function canvasToRgbaBytes(canvas: HTMLCanvasElement): ArrayBuffer {
  const ctx = canvas.getContext("2d")!;
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return imageData.data.buffer;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Export ready images as a multi-page PDF.
 *
 * For each ready image with a cropCanvas:
 *   - Applies rotation via rotateCanvas
 *   - If filter is "binarize": sends RGBA pixels for worker-side binarization
 *   - If filter is "none": converts to JPEG (0.92 quality)
 *
 * @param images     All image entries (only ready ones with cropCanvas are included)
 * @param onProgress Optional callback reporting (current, total) as pages are prepared
 * @returns          A Blob containing the PDF
 */
export async function exportPdf(
  images: ImageEntry[],
  onProgress?: (current: number, total: number) => void,
): Promise<Blob> {
  // Filter to ready images that have a crop canvas and an edit state
  const readyImages = images.filter(
    (img) =>
      img.status === "ready" && img.cropCanvas !== null && img.editState !== null,
  );

  if (readyImages.length === 0) {
    throw new Error("No ready images to export");
  }

  const pages: PageDescriptor[] = [];
  const transferables: ArrayBuffer[] = [];
  const total = readyImages.length;

  for (let i = 0; i < readyImages.length; i++) {
    const img = readyImages[i];
    const editState = img.editState!;
    const cropCanvas = img.cropCanvas!;

    // Apply rotation
    const rotated = rotateCanvas(cropCanvas, editState.rotation);
    const width = rotated.width;
    const height = rotated.height;

    if (editState.filterConfig.type === "binarize") {
      const eraseMask = editState.eraseMask;

      if (eraseMask && img.filteredCanvas) {
        // Has erase mask: apply it to the pre-binarized filteredCanvas, send as JPEG
        const erased = applyEraseMask(img.filteredCanvas, eraseMask);
        const erasedRotated = rotateCanvas(erased, editState.rotation);
        const jpegBytes = await canvasToJpegBytes(erasedRotated, 0.95);
        pages.push({
          type: "jpeg",
          jpegBytes,
          width: erasedRotated.width,
          height: erasedRotated.height,
        });
        transferables.push(jpegBytes);
      } else {
        // No erase mask: send raw RGBA for worker-side binarization (existing behavior)
        const rgbaBytes = canvasToRgbaBytes(rotated);
        const { blockRadiusBps, contrastOffset, upsamplingScale } =
          editState.filterConfig.binarize;

        pages.push({
          type: "binarize",
          rgbaBytes,
          width,
          height,
          blockRadiusBps,
          contrastOffset,
          upsamplingScale,
        });
        transferables.push(rgbaBytes);
      }
    } else {
      // JPEG path: convert canvas to JPEG blob bytes
      const jpegBytes = await canvasToJpegBytes(rotated, 0.92);

      pages.push({
        type: "jpeg",
        jpegBytes,
        width,
        height,
      });
      transferables.push(jpegBytes);
    }

    onProgress?.(i + 1, total);
  }

  // Send all page descriptors to the worker
  const w = ensureWorker();
  const id = msgId++;

  const pdfArrayBuffer = await new Promise<ArrayBuffer>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    w.postMessage({ id, pages }, transferables);
  });

  return new Blob([pdfArrayBuffer], { type: "application/pdf" });
}
