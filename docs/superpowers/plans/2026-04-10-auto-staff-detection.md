# Auto Staff Line Detection — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Detect staff lines in sheet music images via OpenCV.js in a Web Worker and present them as editable dewarp guides.

**Architecture:** A new `staves.worker.ts` loads OpenCV.js from CDN and runs morphological detection (Phases 2-5 from handover). A thin `staves.ts` message-passing layer provides `detectStaves()`. EditorScreen orchestrates: binarize original image → send to worker → convert returned polylines to `DewarpGuide[]` via least-squares Bezier fitting → append to editState → toast result.

**Tech Stack:** OpenCV.js 4.9.0 (CDN, loaded in worker), existing binarize pipeline, existing DewarpGuide system.

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `src/lib/staves.worker.ts` | Create | Web Worker: load OpenCV.js, execute Phases 2-5, return polyline control points |
| `src/lib/staves.ts` | Create | Main-thread API: message-passing to worker, returns `Array<Array<{x,y}>>` |
| `src/lib/fitBezier.ts` | Create | Pure math: fit a cubic Bezier to a polyline via least-squares |
| `src/components/ToolPanel.tsx` | Modify | Add "Auto Detect" button in dewarp guides section |
| `src/components/EditorScreen.tsx` | Modify | Add `handleAutoDetectStaves()`, loading state, toast |

---

### Task 1: Create `fitBezier.ts` — Bezier Fitting Utility

**Files:**
- Create: `src/lib/fitBezier.ts`

This is a pure math module with no dependencies. It converts a polyline (many points) into a single cubic Bezier (p0, cp1, cp2, p3) using least-squares fitting.

- [ ] **Step 1: Create `src/lib/fitBezier.ts`**

```typescript
/**
 * Fit a single cubic Bézier to a polyline using least-squares.
 *
 * Given N points, we fix p0 = first point, p3 = last point,
 * and solve for cp1, cp2 that minimise the sum of squared distances.
 *
 * The parameter t for each point is assigned by chord-length parameterisation.
 */

type Pt = [number, number];

export function fitCubicBezier(
  points: { x: number; y: number }[],
): { p0: Pt; cp1: Pt; cp2: Pt; p3: Pt } {
  if (points.length < 2) {
    const p: Pt = points.length === 1 ? [points[0].x, points[0].y] : [0, 0];
    return { p0: p, cp1: p, cp2: p, p3: p };
  }

  const p0: Pt = [points[0].x, points[0].y];
  const p3: Pt = [points[points.length - 1].x, points[points.length - 1].y];

  if (points.length <= 3) {
    // Not enough points for meaningful fitting — linear interpolation
    return {
      p0,
      cp1: [p0[0] + (p3[0] - p0[0]) / 3, p0[1] + (p3[1] - p0[1]) / 3],
      cp2: [p0[0] + (2 * (p3[0] - p0[0])) / 3, p0[1] + (2 * (p3[1] - p0[1])) / 3],
      p3,
    };
  }

  // Chord-length parameterisation
  const ts: number[] = [0];
  for (let i = 1; i < points.length; i++) {
    const dx = points[i].x - points[i - 1].x;
    const dy = points[i].y - points[i - 1].y;
    ts.push(ts[i - 1] + Math.sqrt(dx * dx + dy * dy));
  }
  const totalLen = ts[ts.length - 1];
  if (totalLen === 0) {
    return { p0, cp1: [...p0], cp2: [...p3], p3 };
  }
  for (let i = 0; i < ts.length; i++) ts[i] /= totalLen;

  // Bernstein basis: B0=(1-t)^3, B1=3t(1-t)^2, B2=3t^2(1-t), B3=t^3
  // We know p0 and p3, solve for cp1 and cp2:
  // point_i ≈ B0*p0 + B1*cp1 + B2*cp2 + B3*p3
  // => B1*cp1 + B2*cp2 ≈ point_i - B0*p0 - B3*p3
  // Normal equations: [sum(B1*B1) sum(B1*B2)] [cp1]   [sum(B1*rhs)]
  //                   [sum(B1*B2) sum(B2*B2)] [cp2] = [sum(B2*rhs)]

  let a11 = 0, a12 = 0, a22 = 0;
  let rx1 = 0, ry1 = 0, rx2 = 0, ry2 = 0;

  for (let i = 0; i < points.length; i++) {
    const t = ts[i];
    const u = 1 - t;
    const b0 = u * u * u;
    const b1 = 3 * t * u * u;
    const b2 = 3 * t * t * u;
    const b3 = t * t * t;

    a11 += b1 * b1;
    a12 += b1 * b2;
    a22 += b2 * b2;

    const rhsX = points[i].x - b0 * p0[0] - b3 * p3[0];
    const rhsY = points[i].y - b0 * p0[1] - b3 * p3[1];

    rx1 += b1 * rhsX;
    ry1 += b1 * rhsY;
    rx2 += b2 * rhsX;
    ry2 += b2 * rhsY;
  }

  const det = a11 * a22 - a12 * a12;
  if (Math.abs(det) < 1e-12) {
    // Degenerate — fall back to linear
    return {
      p0,
      cp1: [p0[0] + (p3[0] - p0[0]) / 3, p0[1] + (p3[1] - p0[1]) / 3],
      cp2: [p0[0] + (2 * (p3[0] - p0[0])) / 3, p0[1] + (2 * (p3[1] - p0[1])) / 3],
      p3,
    };
  }

  const cp1: Pt = [
    (a22 * rx1 - a12 * rx2) / det,
    (a22 * ry1 - a12 * ry2) / det,
  ];
  const cp2: Pt = [
    (a11 * rx2 - a12 * rx1) / det,
    (a11 * ry2 - a12 * ry1) / det,
  ];

  return { p0, cp1, cp2, p3 };
}
```

- [ ] **Step 2: Verify no TypeScript errors**

Run: `npx tsc --noEmit src/lib/fitBezier.ts 2>&1 | head -20`
Expected: no errors (or only unrelated errors from other files)

- [ ] **Step 3: Commit**

```bash
git add src/lib/fitBezier.ts
git commit -m "feat(staves): add least-squares cubic Bezier fitting utility"
```

---

### Task 2: Create `staves.worker.ts` — OpenCV Web Worker

**Files:**
- Create: `src/lib/staves.worker.ts`

This worker loads OpenCV.js from CDN, receives binarized ImageData, and runs Phases 2-5 from the handover algorithm. Returns an array of polylines (each polyline is an array of `{x, y}` points).

- [ ] **Step 1: Create `src/lib/staves.worker.ts`**

```typescript
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
    try {
      // @ts-expect-error — Module global defined by opencv.js
      self.Module = {
        onRuntimeInitialized: () => {
          cvReady = true;
          resolve();
        },
      };
      importScripts("https://docs.opencv.org/4.9.0/opencv.js");
    } catch (err) {
      reject(new Error("Failed to load OpenCV.js: " + (err instanceof Error ? err.message : String(err))));
    }
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
  const src = cv.matFromImageData(new ImageData(imageData, width, height));

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
    const rect = cv.boundingRect(cnt);
    if (rect.width < minLen) continue;
    if (rect.height > rect.width * 0.1) continue;

    // Extract contour points
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
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/staves.worker.ts
git commit -m "feat(staves): add OpenCV web worker for staff line detection"
```

---

### Task 3: Create `staves.ts` — Main-Thread API

**Files:**
- Create: `src/lib/staves.ts`

Thin message-passing layer that manages the worker lifecycle and provides a promise-based API.

- [ ] **Step 1: Create `src/lib/staves.ts`**

```typescript
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
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/staves.ts
git commit -m "feat(staves): add main-thread API for staff line detection worker"
```

---

### Task 4: Modify `ToolPanel.tsx` — Add Auto Detect Button

**Files:**
- Modify: `src/components/ToolPanel.tsx`

Add an "Auto Detect" button in the dewarp guides section. The button triggers a callback prop. Shows spinner when detecting.

- [ ] **Step 1: Add new props to ToolPanel**

In `ToolPanel.tsx`, add to the props interface (around line 151-163):

Add after the `onClearAlignGuides` prop:

```typescript
  onAutoDetectStaves: () => void;
  stavesDetecting: boolean;
```

So the full prop destructuring becomes:

```typescript
export default function ToolPanel({
  eraserActive, onToggleEraser, eraserTool, onSetEraserTool, brushSize, onSetBrushSize,
  guideAddMode, onToggleGuideAdd, onClearGuides,
  alignAddMode, onToggleAlignAdd, onClearAlignGuides,
  onAutoDetectStaves, stavesDetecting,
}: {
  eraserActive: boolean; onToggleEraser: () => void;
  eraserTool: "brush" | "lasso"; onSetEraserTool: (tool: "brush" | "lasso") => void;
  brushSize: number; onSetBrushSize: (size: number) => void;
  guideAddMode: boolean; onToggleGuideAdd: () => void;
  onClearGuides: () => void;
  alignAddMode: boolean; onToggleAlignAdd: () => void;
  onClearAlignGuides: () => void;
  onAutoDetectStaves: () => void;
  stavesDetecting: boolean;
}) {
```

- [ ] **Step 2: Add the Auto Detect button in the dewarp guides section**

In the `{/* Dewarp Guides */}` section (around line 344-372), add the Auto Detect button right after the existing `+ Add Dewarp` button. Insert between the `<Btn icon={<IconGuide />} ... />` and the count/clear display:

```tsx
          <Btn
            icon={stavesDetecting
              ? <svg className="animate-spin" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" /></svg>
              : <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 18h6M4 6h16M4 10h16M4 14h16" /></svg>}
            label={stavesDetecting ? "Detecting..." : "Auto Detect"}
            onClick={onAutoDetectStaves}
            disabled={!hasCrop || stavesDetecting}
          />
```

- [ ] **Step 3: Commit**

```bash
git add src/components/ToolPanel.tsx
git commit -m "feat(staves): add Auto Detect button to ToolPanel dewarp guides section"
```

---

### Task 5: Modify `EditorScreen.tsx` — Wire Up Detection + Toast

**Files:**
- Modify: `src/components/EditorScreen.tsx`

Add the handler that orchestrates: binarize → detect → fit → append guides → toast.

- [ ] **Step 1: Add imports**

At the top of `EditorScreen.tsx`, add these imports:

```typescript
import { detectStaves } from "../lib/staves";
import { fitCubicBezier } from "../lib/fitBezier";
import { DEFAULT_BINARIZE_CONFIG } from "../lib/types";
```

Note: `DEFAULT_BINARIZE_CONFIG` may already be imported via the existing types import. Check and add only if missing.

- [ ] **Step 2: Add state variables**

After the existing state variables (around line 46, after `pendingAlignP0`), add:

```typescript
  const [stavesDetecting, setStavesDetecting] = useState(false);
  const [editorToast, setEditorToast] = useState<string | null>(null);
  const editorToastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
```

Add a `showEditorToast` callback after the state declarations:

```typescript
  const showEditorToast = useCallback((msg: string) => {
    if (editorToastTimer.current) clearTimeout(editorToastTimer.current);
    setEditorToast(msg);
    editorToastTimer.current = setTimeout(() => setEditorToast(null), 3000);
  }, []);
```

- [ ] **Step 3: Add the `handleAutoDetectStaves` handler**

Add after `handleClearAlignGuides` (around line 448):

```typescript
  const handleAutoDetectStaves = useCallback(async () => {
    const img = getSelectedImage(stateRef.current);
    if (!img?.editState || !img.originalCanvas) return;

    setStavesDetecting(true);
    try {
      // Step 1: Binarize the original image with default config
      const binarizedCanvas = await applyBinarize(
        img.originalCanvas,
        DEFAULT_BINARIZE_CONFIG,
      );

      // Step 2: Detect staff lines
      const polylines = await detectStaves(binarizedCanvas);

      if (polylines.length === 0) {
        showEditorToast("No staff lines detected");
        return;
      }

      // Step 3: Convert polylines to DewarpGuides
      // Points from worker are in binarized canvas coords (upscaled).
      // DewarpGuides use mask space (maskWidth x maskHeight).
      const bw = binarizedCanvas.width;
      const bh = binarizedCanvas.height;
      const mw = img.maskWidth;
      const mh = img.maskHeight;

      const newGuides: DewarpGuide[] = polylines.map((pts) => {
        // Scale points from binarized coords to mask space
        const scaled = pts.map((p) => ({
          x: (p.x / bw) * mw,
          y: (p.y / bh) * mh,
        }));
        const { p0, cp1, cp2, p3 } = fitCubicBezier(scaled);
        return { p0, cp1, cp2, p3 };
      });

      // Step 4: Append to existing guides, sort by vertical position
      const currentImg = getSelectedImage(stateRef.current);
      if (!currentImg?.editState) return;
      const es = currentImg.editState;

      dispatch({ type: "PUSH_HISTORY", id: currentImg.id });
      const dewarpGuides = [...es.dewarpGuides, ...newGuides].sort(
        (a, b) => (a.p0[1] + a.p3[1]) / 2 - (b.p0[1] + b.p3[1]) / 2,
      );
      dispatch({
        type: "SET_EDIT_STATE",
        id: currentImg.id,
        editState: { ...es, dewarpGuides },
      });

      showEditorToast(`Detected ${polylines.length} staff line${polylines.length !== 1 ? "s" : ""}`);
    } catch (err) {
      console.error("Staff detection failed:", err);
      showEditorToast("Staff detection failed");
    } finally {
      setStavesDetecting(false);
    }
  }, [dispatch, showEditorToast]);
```

- [ ] **Step 4: Pass new props to ToolPanel**

In the `<ToolPanel>` JSX (around line 611-633), add the two new props:

```tsx
          onClearAlignGuides={handleClearAlignGuides}
          onAutoDetectStaves={handleAutoDetectStaves}
          stavesDetecting={stavesDetecting}
```

- [ ] **Step 5: Add toast rendering**

At the end of the component's return JSX, just before the closing `</div>` of the root element (around line 671), add:

```tsx
      {/* Editor toast */}
      {editorToast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-lg bg-[var(--bg-elevated)] border border-[var(--border)] shadow-lg text-[12px] text-[var(--text-primary)] animate-[fadeInUp_0.2s_ease-out]">
          {editorToast}
        </div>
      )}
```

- [ ] **Step 6: Commit**

```bash
git add src/components/EditorScreen.tsx
git commit -m "feat(staves): wire up auto staff detection in EditorScreen with toast feedback"
```

---

### Task 6: Build Verification + Manual Test

**Files:** None (verification only)

- [ ] **Step 1: Run the build**

Run: `npm run build`
Expected: build succeeds with no errors

- [ ] **Step 2: Run lint**

Run: `npm run lint`
Expected: no new lint errors

- [ ] **Step 3: Manual test checklist**

Run: `npm run dev`

Test the following in the browser:
1. Open an image in the editor
2. Click "Auto Detect" in the dewarp guides section
3. First click triggers OpenCV.js download (button shows "Detecting...")
4. After detection: toast shows "Detected N staff lines" or "No staff lines detected"
5. Detected lines appear as orange dewarp guide curves on the editor canvas
6. User can drag guide endpoints/control points to adjust
7. User can delete individual guides (select + Delete key)
8. "Clear" button removes all guides including auto-detected ones
9. Undo reverts the auto-detection (restores previous guides state)
10. Second detection appends to existing guides
11. Works with non-music images (should show "No staff lines detected")

- [ ] **Step 4: Final commit if any fixes needed**

```bash
git add -A
git commit -m "fix(staves): address build/lint issues from staff detection feature"
```
