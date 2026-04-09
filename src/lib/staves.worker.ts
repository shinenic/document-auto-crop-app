/**
 * Staff line detection Web Worker.
 *
 * Loads OpenCV.js from CDN on first use.
 * Receives binarized image data, runs morphological detection (Phases 2-5),
 * returns polyline control points for each detected staff line.
 */

declare const cv: any; // eslint-disable-line @typescript-eslint/no-explicit-any

interface DetectRequest {
  id: number;
  imageData: ArrayBuffer;
  width: number;
  height: number;
}

interface DetectResult {
  id: number;
  ok: true;
  lines: Array<Array<{ x: number; y: number }>>;
}

interface DetectError {
  id: number;
  ok: false;
  error: string;
}

// --- OpenCV Loading ---

let cvReady = false;
let cvLoading: Promise<void> | null = null;

function loadOpenCV(): Promise<void> {
  if (cvReady) return Promise.resolve();
  if (cvLoading) return cvLoading;

  cvLoading = new Promise<void>((resolve, reject) => {
    // @ts-expect-error — Module global defined by opencv.js WASM runtime
    self.Module = {
      onRuntimeInitialized: () => {
        cvReady = true;
        resolve();
      },
    };
    // Use fetch+eval instead of importScripts (module workers don't support importScripts)
    fetch("https://docs.opencv.org/4.9.0/opencv.js")
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.text();
      })
      .then((code) => {
        // eslint-disable-next-line no-eval
        (0, eval)(code);
      })
      .catch((err) => {
        cvLoading = null; // allow retry on transient failure
        reject(new Error("Failed to load OpenCV.js: " + (err instanceof Error ? err.message : String(err))));
      });
  });

  return cvLoading;
}

// --- Detection Algorithm (Phases 2-5) ---

const PARAMS = {
  maxRunLen: 5,
  kernelLen: 40,
  minLenPct: 0.4,
  smoothWin: 50,
  ctrlStep: 25,
};

function detectStaves(
  imageData: Uint8ClampedArray,
  width: number,
  height: number,
): Array<Array<{ x: number; y: number }>> {
  // Create OpenCV Mat from RGBA image data
  const src = cv.matFromImageData({ data: imageData, width, height } as ImageData);

  // Convert to grayscale then binary (input is already binarized B&W,
  // but it's RGBA — convert to single-channel binary)
  const gray = new cv.Mat();
  cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
  src.delete();

  // Threshold to ensure clean binary (our binarize outputs 0 or 255 in RGB)
  const binMat = new cv.Mat();
  cv.threshold(gray, binMat, 127, 255, cv.THRESH_BINARY);
  gray.delete();

  // Invert: we need BINARY_INV (black lines = white in our binary)
  // Our B&W filter: white background=255, black ink=0
  // OpenCV morphology expects: objects=255, background=0
  const invMat = new cv.Mat();
  cv.bitwise_not(binMat, invMat);
  binMat.delete();

  const imgW = width;

  // --- Phase 2: Vertical morphology subtraction ---
  const vKernel = cv.getStructuringElement(
    cv.MORPH_RECT,
    new cv.Size(1, PARAMS.maxRunLen * 2 + 1),
  );
  const noLines = new cv.Mat();
  cv.morphologyEx(invMat, noLines, cv.MORPH_OPEN, vKernel);
  vKernel.delete();

  const linesOnly = new cv.Mat();
  cv.subtract(invMat, noLines, linesOnly);
  noLines.delete();
  invMat.delete();

  // --- Phase 3: Horizontal erode + dilate ---
  const smallErodeK = cv.getStructuringElement(
    cv.MORPH_RECT,
    new cv.Size(Math.round(PARAMS.kernelLen / 3), 1),
  );
  cv.erode(linesOnly, linesOnly, smallErodeK);
  smallErodeK.delete();

  const hKernel = cv.getStructuringElement(
    cv.MORPH_RECT,
    new cv.Size(PARAMS.kernelLen, 1),
  );
  const filteredMat = new cv.Mat();
  cv.dilate(linesOnly, filteredMat, hKernel);
  hKernel.delete();
  linesOnly.delete();

  // --- Phase 4: Contour detection + filtering ---
  const contours = new cv.MatVector();
  const hierarchy = new cv.Mat();
  cv.findContours(
    filteredMat,
    contours,
    hierarchy,
    cv.RETR_EXTERNAL,
    cv.CHAIN_APPROX_SIMPLE,
  );
  hierarchy.delete();
  filteredMat.delete();

  const minLen = imgW * PARAMS.minLenPct;

  interface StaffLine {
    y: number;
    points: Array<{ x: number; y: number }>;
  }

  const results: StaffLine[] = [];

  for (let i = 0; i < contours.size(); i++) {
    const cnt = contours.get(i);
    try {
      const rect = cv.boundingRect(cnt);
      if (rect.width < minLen) continue;
      if (rect.height > rect.width * 0.1) continue;

      // Extract contour points (data32S stores [x0,y0,x1,y1,...] for CHAIN_APPROX_SIMPLE)
      const pts: Array<{ x: number; y: number }> = [];
      for (let j = 0; j < cnt.data32S.length; j += 2) {
        pts.push({ x: cnt.data32S[j], y: cnt.data32S[j + 1] });
      }

      // Median y for sorting
      const ys = pts.map((p) => p.y);
      ys.sort((a, b) => a - b);
      const medianY = ys[Math.floor(ys.length / 2)];

      // --- Phase 5: Polyline extraction + smoothing + downsampling ---

      // Group by x, take median y per x
      const byX = new Map<number, number[]>();
      for (const p of pts) {
        if (!byX.has(p.x)) byX.set(p.x, []);
        byX.get(p.x)!.push(p.y);
      }
      const rawPolyline: Array<{ x: number; y: number }> = [];
      for (const [px, pys] of byX) {
        pys.sort((a, b) => a - b);
        rawPolyline.push({ x: px, y: pys[Math.floor(pys.length / 2)] });
      }
      rawPolyline.sort((a, b) => a.x - b.x);

      // Moving average smoothing
      const smoothed: Array<{ x: number; y: number }> = [];
      for (let k = 0; k < rawPolyline.length; k++) {
        const lo = Math.max(0, k - Math.floor(PARAMS.smoothWin / 2));
        const hi = Math.min(rawPolyline.length - 1, k + Math.floor(PARAMS.smoothWin / 2));
        let sumY = 0;
        for (let m = lo; m <= hi; m++) sumY += rawPolyline[m].y;
        smoothed.push({ x: rawPolyline[k].x, y: sumY / (hi - lo + 1) });
      }

      // Trim endpoints (barline intersections)
      const trimPx = Math.max(5, Math.round(smoothed.length * 0.02));
      const trimmed = smoothed.slice(trimPx, smoothed.length - trimPx);
      if (trimmed.length < 2) continue;

      // Subsample to control points
      const finalPolyline = [trimmed[0]];
      for (let k = PARAMS.ctrlStep; k < trimmed.length - 1; k += PARAMS.ctrlStep) {
        finalPolyline.push(trimmed[k]);
      }
      if (trimmed.length > 1) finalPolyline.push(trimmed[trimmed.length - 1]);

      results.push({ y: medianY, points: finalPolyline });
    } finally {
      cnt.delete();
    }
  }
  contours.delete();

  // Sort by y position
  results.sort((a, b) => a.y - b.y);

  return results.map((r) => r.points);
}

// --- Message Handler ---

self.onmessage = async (e: MessageEvent<DetectRequest>) => {
  const { id, imageData, width, height } = e.data;
  try {
    await loadOpenCV();
    const lines = detectStaves(
      new Uint8ClampedArray(imageData),
      width,
      height,
    );
    const msg: DetectResult = { id, ok: true, lines };
    (self as unknown as Worker).postMessage(msg);
  } catch (err) {
    const msg: DetectError = {
      id,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
    (self as unknown as Worker).postMessage(msg);
  }
};
