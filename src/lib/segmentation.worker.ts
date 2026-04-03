import * as ort from "onnxruntime-web";

const INPUT_SIZE = 256;
const MODEL_PATH = "/model/fairscan-segmentation-model.onnx";

let session: ort.InferenceSession | null = null;

async function init(): Promise<void> {
  ort.env.wasm.wasmPaths =
    "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.24.3/dist/";
  ort.env.wasm.numThreads = 1;
  session = await ort.InferenceSession.create(MODEL_PATH, {
    executionProviders: ["wasm"],
  });
  // Warm-up inference
  const dummy = new Float32Array(INPUT_SIZE * INPUT_SIZE * 3);
  const tensor = new ort.Tensor("float32", dummy, [
    1,
    INPUT_SIZE,
    INPUT_SIZE,
    3,
  ]);
  await session.run({ [session.inputNames[0]]: tensor });
}

function rgbaToRgbFloat(rgbaData: Uint8Array): Float32Array {
  const pixelCount = rgbaData.length / 4;
  const rgb = new Float32Array(pixelCount * 3);
  for (let i = 0; i < pixelCount; i++) {
    rgb[i * 3] = rgbaData[i * 4];
    rgb[i * 3 + 1] = rgbaData[i * 4 + 1];
    rgb[i * 3 + 2] = rgbaData[i * 4 + 2];
  }
  return rgb;
}

function threshold(outputData: Float32Array): Uint8Array {
  const mask = new Uint8Array(outputData.length);
  for (let i = 0; i < outputData.length; i++) {
    mask[i] = outputData[i] > 0.5 ? 255 : 0;
  }
  return mask;
}

let runQueue: Promise<unknown> = Promise.resolve();

async function infer(
  rgbaData: Uint8Array,
): Promise<{ mask: Uint8Array; duration: number }> {
  return new Promise((resolve, reject) => {
    runQueue = runQueue.then(async () => {
      if (!session) {
        reject(new Error("Model not loaded"));
        return;
      }
      const t0 = performance.now();
      const rgb = rgbaToRgbFloat(rgbaData);
      const tensor = new ort.Tensor("float32", rgb, [
        1,
        INPUT_SIZE,
        INPUT_SIZE,
        3,
      ]);
      const results = await session.run({
        [session.inputNames[0]]: tensor,
      });
      const output = results[session.outputNames[0]];
      const mask = threshold(output.data as Float32Array);
      resolve({ mask, duration: performance.now() - t0 });
    });
  });
}

self.onmessage = async (e: MessageEvent) => {
  const { type } = e.data;
  try {
    if (type === "init") {
      await init();
      self.postMessage({ ok: true, id: e.data.id });
    } else if (type === "infer") {
      const result = await infer(e.data.rgbaData);
      self.postMessage({ ok: true, result, id: e.data.id });
    }
  } catch (err) {
    self.postMessage({
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      id: e.data.id,
    });
  }
};
