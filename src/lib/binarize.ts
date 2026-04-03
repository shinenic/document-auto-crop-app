/**
 * Binarization service — worker communication layer.
 * Manages the binarize web worker lifecycle and provides applyBinarize().
 */
import type { BinarizeConfig } from "./types";

let worker: Worker | null = null;
let msgId = 0;
const pending = new Map<
  number,
  {
    resolve: (v: { data: ArrayBuffer; width: number; height: number }) => void;
    reject: (e: Error) => void;
  }
>();

function ensureWorker(): Worker {
  if (!worker) {
    worker = new Worker(
      new URL("./binarize.worker.ts", import.meta.url),
      { type: "module" },
    );
    worker.onmessage = (e: MessageEvent) => {
      const { id, ok, error, data, width, height } = e.data;
      const p = pending.get(id);
      if (!p) return;
      pending.delete(id);
      if (ok) p.resolve({ data, width, height });
      else p.reject(new Error(error));
    };
  }
  return worker;
}

/**
 * Apply binarization filter to a canvas.
 * Returns a new HTMLCanvasElement with the binarized (upscaled) result.
 */
export async function applyBinarize(
  sourceCanvas: HTMLCanvasElement,
  config: BinarizeConfig,
): Promise<HTMLCanvasElement> {
  const bitmap = await createImageBitmap(sourceCanvas);
  const w = ensureWorker();
  const id = msgId++;

  return new Promise((resolve, reject) => {
    pending.set(id, {
      resolve: ({ data, width, height }) => {
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d")!;
        const imgData = new ImageData(
          new Uint8ClampedArray(data),
          width,
          height,
        );
        ctx.putImageData(imgData, 0, 0);
        resolve(canvas);
      },
      reject,
    });

    w.postMessage(
      {
        id,
        bitmap,
        blockRadiusBps: config.blockRadiusBps,
        contrastOffset: config.contrastOffset,
        upsamplingScale: config.upsamplingScale,
      },
      [bitmap],
    );
  });
}
