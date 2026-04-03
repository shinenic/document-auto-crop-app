/**
 * Segmentation API — worker communication layer.
 * Manages the ONNX inference web worker lifecycle.
 */
import type { InferenceResult } from "./types";
import { INPUT_SIZE } from "./types";

let worker: Worker | null = null;
let initPromise: Promise<void> | null = null;
let msgId = 0;
const pending = new Map<
  number,
  { resolve: (v: unknown) => void; reject: (e: Error) => void }
>();

function call(
  type: string,
  data: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const id = msgId++;
    pending.set(id, {
      resolve: resolve as (v: unknown) => void,
      reject,
    });
    worker!.postMessage({ type, id, ...data });
  });
}

function handleMessage(e: MessageEvent) {
  const { id, ok, error, ...rest } = e.data;
  const p = pending.get(id);
  if (!p) return;
  pending.delete(id);
  if (ok) p.resolve(rest);
  else p.reject(new Error(error));
}

export function loadModel(): Promise<void> {
  if (initPromise) return initPromise;

  initPromise = (async () => {
    worker = new Worker(
      new URL("./segmentation.worker.ts", import.meta.url),
      { type: "module" },
    );
    worker.onmessage = handleMessage;
    await call("init");
  })();

  return initPromise;
}

export function isModelLoaded(): boolean {
  return worker !== null && initPromise !== null;
}

export async function runInference(
  imageSource: HTMLCanvasElement | HTMLImageElement,
): Promise<InferenceResult> {
  await initPromise;

  const canvas = document.createElement("canvas");
  canvas.width = INPUT_SIZE;
  canvas.height = INPUT_SIZE;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(imageSource, 0, 0, INPUT_SIZE, INPUT_SIZE);

  const imageData = ctx.getImageData(0, 0, INPUT_SIZE, INPUT_SIZE);
  const rgbaData = new Uint8Array(imageData.data);

  const response = (await call("infer", { rgbaData })) as {
    result: { mask: Uint8Array; duration: number };
  };

  return {
    mask: new Uint8Array(response.result.mask),
    duration: response.result.duration,
    width: INPUT_SIZE,
    height: INPUT_SIZE,
  };
}
