/**
 * Staff line detection — main thread API.
 * Manages the staves web worker and provides detectStaves().
 */

let worker: Worker | null = null;
let msgId = 0;
const pending = new Map<
  number,
  {
    resolve: (lines: Array<Array<{ x: number; y: number }>>) => void;
    reject: (e: Error) => void;
  }
>();

function ensureWorker(): Worker {
  if (!worker) {
    worker = new Worker(
      new URL("./staves.worker.ts", import.meta.url),
      { type: "module" },
    );
    worker.onmessage = (e: MessageEvent) => {
      const { id, ok, error, lines } = e.data;
      const p = pending.get(id);
      if (!p) return;
      pending.delete(id);
      if (ok) p.resolve(lines);
      else p.reject(new Error(error));
    };
  }
  return worker;
}

/**
 * Detect staff lines from a binarized canvas.
 * Returns an array of polylines, each being an array of {x, y} points
 * in the coordinate space of the input canvas.
 */
export async function detectStaves(
  binarizedCanvas: HTMLCanvasElement,
): Promise<Array<Array<{ x: number; y: number }>>> {
  const w = binarizedCanvas.width;
  const h = binarizedCanvas.height;
  const ctx = binarizedCanvas.getContext("2d")!;
  const imageData = ctx.getImageData(0, 0, w, h);
  const buffer = imageData.data.buffer.slice(0); // copy for transfer

  const wk = ensureWorker();
  const id = msgId++;

  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    wk.postMessage({ id, imageData: buffer, width: w, height: h }, [buffer]);
  });
}
