# Staff Guide Lines + Piecewise Dewarping Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add user-drawn guide lines to the QuadEditor that trace staff line curvature, with piecewise Coons patch dewarping to straighten those lines in the crop output.

**Architecture:** Guide lines are stored as `GuideLine[]` inside `EditState` (undo/redo). Each guide line is a cubic Bezier from the quad's left edge to the right edge. When guide lines exist, `perspectiveCropPiecewise()` replaces `perspectiveCrop()` — it splits the quad into horizontal strips at each guide line and runs an independent Coons patch per strip. The QuadEditor renders guide lines and supports two-click creation (left endpoint, right endpoint) plus drag-to-curve.

**Tech Stack:** TypeScript, React 19, Next.js 16 (static export), Canvas 2D API, Tailwind CSS

**No test framework** is configured. Verification via `npm run build` and `npm run lint`.

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `src/lib/types.ts` | Modify | Add `GuideLine` interface; add `guideLines` to `EditState` |
| `src/lib/crop.ts` | Modify | Export `evalBezier`, `makeArcLengthEval`; add `subdivideBezier()`, `perspectiveCropPiecewise()` |
| `src/context/AppContext.tsx` | Modify | Update `cloneEditState`, `editStateFromQuad` to include `guideLines` |
| `src/lib/draft.ts` | Modify | Add `guideLines` to `ManifestEditState`, `editStateToManifest`, `manifestToEditState` |
| `src/components/QuadEditor.tsx` | Modify | Render guide lines; add/drag/delete interaction; add-mode state |
| `src/components/EditorScreen.tsx` | Modify | Pass `guideAddMode` to QuadEditor; switch to piecewise crop when guideLines present; include guideLines in cropKey |
| `src/components/ToolPanel.tsx` | Modify | Add Guide Lines section with add/clear buttons and count display |

---

### Task 1: Types + State Foundation

**Files:**
- Modify: `src/lib/types.ts:56-62`
- Modify: `src/context/AppContext.tsx:44-76`
- Modify: `src/lib/draft.ts:18-24,47-65`

- [ ] **Step 1: Add GuideLine type to types.ts**

In `src/lib/types.ts`, add after the `EditState` opening (line 56) — insert the new interface before `EditState`, and add the `guideLines` field:

```typescript
// Add after line 53 (after EraseMask interface closing brace)

/** A user-drawn guide line: cubic Bézier from quad L edge to R edge. */
export interface GuideLine {
  leftV: number;           // parameter on quad L edge (0=TL, 1=BL)
  rightV: number;          // parameter on quad R edge (0=TR, 1=BR)
  cp1: [number, number];   // Bezier control point 1 (mask space)
  cp2: [number, number];   // Bezier control point 2 (mask space)
}
```

In the `EditState` interface (line 56-62), add `guideLines` after `edgeFits`:

```typescript
export interface EditState {
  corners: [number, number][];
  edgeFits: EdgeFit[];
  guideLines: GuideLine[];  // NEW — sorted by avg v position
  rotation: 0 | 90 | 180 | 270;
  filterConfig: FilterConfig;
  eraseMask: EraseMask | null;
}
```

- [ ] **Step 2: Update cloneEditState in AppContext.tsx**

In `src/context/AppContext.tsx`, update `cloneEditState` (line 44-59) to clone `guideLines`:

```typescript
function cloneEditState(s: EditState): EditState {
  return {
    corners: s.corners.map((c) => [...c] as [number, number]),
    edgeFits: s.edgeFits.map((f) => ({
      cp1: [...f.cp1] as [number, number],
      cp2: [...f.cp2] as [number, number],
      isArc: f.isArc,
    })),
    guideLines: s.guideLines.map((g) => ({
      leftV: g.leftV,
      rightV: g.rightV,
      cp1: [...g.cp1] as [number, number],
      cp2: [...g.cp2] as [number, number],
    })),
    rotation: s.rotation,
    filterConfig: {
      type: s.filterConfig.type,
      binarize: { ...s.filterConfig.binarize },
    },
    eraseMask: s.eraseMask ? cloneEraseMask(s.eraseMask) : null,
  };
}
```

- [ ] **Step 3: Update editStateFromQuad in AppContext.tsx**

In `src/context/AppContext.tsx`, update `editStateFromQuad` (line 61-76) to initialize `guideLines: []`:

```typescript
export function editStateFromQuad(quad: QuadResult): EditState {
  return {
    corners: quad.corners.map((c) => [...c] as [number, number]),
    edgeFits: quad.edgeFits.map((f) => ({
      cp1: [...f.cp1] as [number, number],
      cp2: [...f.cp2] as [number, number],
      isArc: f.isArc,
    })),
    guideLines: [],
    rotation: 0,
    filterConfig: {
      type: DEFAULT_FILTER_CONFIG.type,
      binarize: { ...DEFAULT_FILTER_CONFIG.binarize },
    },
    eraseMask: null,
  };
}
```

- [ ] **Step 4: Update draft persistence**

In `src/lib/draft.ts`, add `guideLines` to `ManifestEditState` (after `edgeFits` at line 20):

```typescript
interface ManifestEditState {
  corners: [number, number][];
  edgeFits: EdgeFit[];
  guideLines?: { leftV: number; rightV: number; cp1: [number, number]; cp2: [number, number] }[];
  rotation: 0 | 90 | 180 | 270;
  filterConfig: { type: "none" | "binarize"; binarize: { blockRadiusBps: number; contrastOffset: number; upsamplingScale: number } };
  eraseMaskFile: string | null;
}
```

Update `editStateToManifest` (around line 47) to include `guideLines`:

```typescript
function editStateToManifest(es: EditState, eraseMaskFile: string | null): ManifestEditState {
  return {
    corners: es.corners.map(c => [...c] as [number, number]),
    edgeFits: es.edgeFits.map(f => ({ cp1: [...f.cp1] as [number, number], cp2: [...f.cp2] as [number, number], isArc: f.isArc })),
    guideLines: es.guideLines.map(g => ({ leftV: g.leftV, rightV: g.rightV, cp1: [...g.cp1] as [number, number], cp2: [...g.cp2] as [number, number] })),
    rotation: es.rotation,
    filterConfig: { type: es.filterConfig.type, binarize: { ...es.filterConfig.binarize } },
    eraseMaskFile,
  };
}
```

Update `manifestToEditState` (around line 57) to restore `guideLines`:

```typescript
function manifestToEditState(m: ManifestEditState, eraseMask: EraseMask | null): EditState {
  return {
    corners: m.corners.map(c => [...c] as [number, number]),
    edgeFits: m.edgeFits.map(f => ({ cp1: [...f.cp1] as [number, number], cp2: [...f.cp2] as [number, number], isArc: f.isArc })),
    guideLines: (m.guideLines ?? []).map(g => ({ leftV: g.leftV, rightV: g.rightV, cp1: [...g.cp1] as [number, number], cp2: [...g.cp2] as [number, number] })),
    rotation: m.rotation,
    filterConfig: { type: m.filterConfig.type, binarize: { ...m.filterConfig.binarize } },
    eraseMask,
  };
}
```

- [ ] **Step 5: Verify build**

Run: `npm run build`

- [ ] **Step 6: Commit**

```bash
git add src/lib/types.ts src/context/AppContext.tsx src/lib/draft.ts
git commit -m "feat: add GuideLine type and state foundation for staff guide lines"
```

---

### Task 2: Piecewise Coons Patch in crop.ts

**Files:**
- Modify: `src/lib/crop.ts:10-75,79-222`

- [ ] **Step 1: Export existing Bezier helpers**

In `src/lib/crop.ts`, export `evalBezier` and `makeArcLengthEval` by changing their declarations:

```typescript
// Line 11: change "function evalBezier" to "export function evalBezier"
export function evalBezier(
  p0: [number, number],
  cp1: [number, number],
  cp2: [number, number],
  p3: [number, number],
  t: number,
): [number, number] {
```

```typescript
// Line 66: change "function makeArcLengthEval" to "export function makeArcLengthEval"
export function makeArcLengthEval(
  p0: [number, number],
  cp1: [number, number],
  cp2: [number, number],
  p3: [number, number],
): (u: number) => [number, number] {
```

- [ ] **Step 2: Add de Casteljau subdivision**

Add after `makeArcLengthEval` (after line 75), before the `perspectiveCrop` function:

```typescript
// ─── De Casteljau subdivision ──────────────────────────────────────────────

/** Split a cubic Bezier at parameter t, return left and right sub-curves. */
function splitBezier(
  p0: [number, number], cp1: [number, number], cp2: [number, number], p3: [number, number], t: number,
): { left: [[number, number], [number, number], [number, number], [number, number]]; right: [[number, number], [number, number], [number, number], [number, number]] } {
  const lerp = (a: [number, number], b: [number, number], s: number): [number, number] =>
    [a[0] + (b[0] - a[0]) * s, a[1] + (b[1] - a[1]) * s];
  const a = lerp(p0, cp1, t);
  const b = lerp(cp1, cp2, t);
  const c = lerp(cp2, p3, t);
  const d = lerp(a, b, t);
  const e = lerp(b, c, t);
  const f = lerp(d, e, t);
  return {
    left: [p0, a, d, f],
    right: [f, e, c, p3],
  };
}

/** Extract Bezier sub-curve from t=tStart to t=tEnd. */
export function subBezier(
  p0: [number, number], cp1: [number, number], cp2: [number, number], p3: [number, number],
  tStart: number, tEnd: number,
): [[number, number], [number, number], [number, number], [number, number]] {
  // Split at tStart, take right half
  const { right: after } = splitBezier(p0, cp1, cp2, p3, tStart);
  // Re-parameterize tEnd into the after-curve's parameter space
  const tMapped = (tEnd - tStart) / (1 - tStart);
  // Split after-curve at the mapped parameter, take left half
  const { left } = splitBezier(after[0], after[1], after[2], after[3], tMapped);
  return left;
}
```

- [ ] **Step 3: Add perspectiveCropPiecewise function**

Add after `subBezier`, before the existing `perspectiveCrop`:

```typescript
// ─── Piecewise Coons patch crop ────────────────────────────────────────────

import type { GuideLine } from "./types";

/**
 * Piecewise Coons patch: guide lines split the quad into horizontal strips.
 * Each strip gets an independent Coons patch, producing a horizontal band.
 * Strips are stacked vertically to form the final output.
 */
export function perspectiveCropPiecewise(
  originalCanvas: HTMLCanvasElement,
  quadResult: QuadResult,
  guideLines: GuideLine[],
  maskWidth: number,
  maskHeight: number,
  maxSize?: number,
): HTMLCanvasElement | null {
  const { corners, edgeFits } = quadResult;
  const imgW = originalCanvas.width, imgH = originalCanvas.height;
  const sX = imgW / maskWidth, sY = imgH / maskHeight;

  // Corner labels: P00=TL, P10=TR, P11=BR, P01=BL
  const P00 = corners[0], P10 = corners[1], P11 = corners[2], P01 = corners[3];

  // Build L and R edge evaluators (arc-length parameterized)
  // L: TL→BL (edge 3, reversed CPs)
  const Lfull = makeArcLengthEval(P00, edgeFits[3].cp2, edgeFits[3].cp1, P01);
  // R: TR→BR (edge 1)
  const Rfull = makeArcLengthEval(P10, edgeFits[1].cp1, edgeFits[1].cp2, P11);

  // L edge raw Bezier points (for sub-segment extraction)
  const Lraw: [[number, number], [number, number], [number, number], [number, number]] =
    [P00, edgeFits[3].cp2, edgeFits[3].cp1, P01];
  const Rraw: [[number, number], [number, number], [number, number], [number, number]] =
    [P10, edgeFits[1].cp1, edgeFits[1].cp2, P11];

  // Sort guide lines by average v position
  const sorted = [...guideLines].sort((a, b) => (a.leftV + a.rightV) / 2 - (b.leftV + b.rightV) / 2);

  // Build strip boundaries: array of { topCurve, botCurve, vTop, vBot }
  // where topCurve/botCurve are arc-length evaluators for the top/bottom edge of each strip
  interface StripDef {
    topEval: (u: number) => [number, number];
    botEval: (u: number) => [number, number];
    leftEval: (v: number) => [number, number];
    rightEval: (v: number) => [number, number];
    corners: { P00: [number, number]; P10: [number, number]; P01: [number, number]; P11: [number, number] };
    vSpan: number;
  }

  // V-boundaries: 0, guideLine[0].v, guideLine[1].v, ..., 1
  const vBounds: number[] = [0];
  for (const g of sorted) vBounds.push((g.leftV + g.rightV) / 2);
  vBounds.push(1);

  // Curve evaluators for each boundary
  // Boundary 0 = top quad edge, boundary N+1 = bottom quad edge
  // Boundaries 1..N = guide lines
  interface BoundaryEval {
    eval: (u: number) => [number, number];
    leftPt: [number, number];
    rightPt: [number, number];
  }

  const boundaryEvals: BoundaryEval[] = [];

  // Top edge: T(u) TL→TR
  const topEval = makeArcLengthEval(P00, edgeFits[0].cp1, edgeFits[0].cp2, P10);
  boundaryEvals.push({ eval: topEval, leftPt: P00, rightPt: P10 });

  // Guide lines
  for (const g of sorted) {
    const p0 = Lfull(g.leftV);
    const p3 = Rfull(g.rightV);
    const gEval = makeArcLengthEval(p0, g.cp1, g.cp2, p3);
    boundaryEvals.push({ eval: gEval, leftPt: p0, rightPt: p3 });
  }

  // Bottom edge: B(u) BL→BR (reversed)
  const botEval = makeArcLengthEval(P01, edgeFits[2].cp2, edgeFits[2].cp1, P11);
  boundaryEvals.push({ eval: botEval, leftPt: P01, rightPt: P11 });

  // Output dimensions — use same computation as single-patch
  const imgCorners: [number, number][] = corners.map((c) => [c[0] * sX, c[1] * sY]);
  const dims = computeCropDimensions(imgCorners, imgW, imgH);
  if (!dims) return null;
  let outW = dims.outW;
  let outH = dims.outH;

  if (maxSize && (outW > maxSize || outH > maxSize)) {
    const scale = maxSize / Math.max(outW, outH);
    outW = Math.round(outW * scale);
    outH = Math.round(outH * scale);
  }
  if (outW < 2 || outH < 2) return null;

  // Allocate output
  const srcData = originalCanvas.getContext("2d")!.getImageData(0, 0, imgW, imgH);
  const outCanvas = document.createElement("canvas");
  outCanvas.width = outW;
  outCanvas.height = outH;
  const outCtx = outCanvas.getContext("2d")!;
  const outData = outCtx.createImageData(outW, outH);

  // Process each strip
  const numStrips = vBounds.length - 1;
  let yOffset = 0;

  for (let si = 0; si < numStrips; si++) {
    const vTop = vBounds[si];
    const vBot = vBounds[si + 1];
    const vSpan = vBot - vTop;

    const stripH = si < numStrips - 1
      ? Math.round(outH * vSpan)
      : outH - yOffset; // last strip gets remaining pixels

    if (stripH < 1) continue;

    const topB = boundaryEvals[si];
    const botB = boundaryEvals[si + 1];

    // Left sub-edge for this strip
    const lSub = subBezier(Lraw[0], Lraw[1], Lraw[2], Lraw[3], vTop, vBot);
    const leftEval = makeArcLengthEval(lSub[0], lSub[1], lSub[2], lSub[3]);

    // Right sub-edge for this strip
    const rSub = subBezier(Rraw[0], Rraw[1], Rraw[2], Rraw[3], vTop, vBot);
    const rightEval = makeArcLengthEval(rSub[0], rSub[1], rSub[2], rSub[3]);

    // Strip corners
    const sP00 = topB.leftPt, sP10 = topB.rightPt;
    const sP01 = botB.leftPt, sP11 = botB.rightPt;

    // Pre-compute top and bottom boundary curves
    const topPts = new Float64Array(outW * 2);
    const botPts = new Float64Array(outW * 2);
    for (let px = 0; px < outW; px++) {
      const u = px / (outW - 1);
      const t = topB.eval(u), b = botB.eval(u);
      topPts[px * 2] = t[0]; topPts[px * 2 + 1] = t[1];
      botPts[px * 2] = b[0]; botPts[px * 2 + 1] = b[1];
    }

    // Coons patch per strip
    for (let py = 0; py < stripH; py++) {
      const v = stripH > 1 ? py / (stripH - 1) : 0.5;
      const lv = leftEval(v), rv = rightEval(v);
      const omv = 1 - v;

      for (let px = 0; px < outW; px++) {
        const u = px / (outW - 1);
        const omu = 1 - u;
        const tu0 = topPts[px * 2], tu1 = topPts[px * 2 + 1];
        const bu0 = botPts[px * 2], bu1 = botPts[px * 2 + 1];

        const mx = omv * tu0 + v * bu0 + omu * lv[0] + u * rv[0]
          - omu * omv * sP00[0] - u * omv * sP10[0] - omu * v * sP01[0] - u * v * sP11[0];
        const my = omv * tu1 + v * bu1 + omu * lv[1] + u * rv[1]
          - omu * omv * sP00[1] - u * omv * sP10[1] - omu * v * sP01[1] - u * v * sP11[1];

        const srcX = mx * sX, srcY = my * sY;
        if (srcX < 0 || srcX >= imgW - 1 || srcY < 0 || srcY >= imgH - 1) continue;

        const ix = Math.floor(srcX), iy = Math.floor(srcY);
        const fx = srcX - ix, fy = srcY - iy;
        const outIdx = ((yOffset + py) * outW + px) * 4;
        for (let c = 0; c < 3; c++) {
          const v00 = srcData.data[(iy * imgW + ix) * 4 + c];
          const v10 = srcData.data[(iy * imgW + ix + 1) * 4 + c];
          const v01 = srcData.data[((iy + 1) * imgW + ix) * 4 + c];
          const v11 = srcData.data[((iy + 1) * imgW + ix + 1) * 4 + c];
          outData.data[outIdx + c] = Math.round(
            v00 * (1 - fx) * (1 - fy) + v10 * fx * (1 - fy) + v01 * (1 - fx) * fy + v11 * fx * fy,
          );
        }
        outData.data[outIdx + 3] = 255;
      }
    }

    yOffset += stripH;
  }

  outCtx.putImageData(outData, 0, 0);
  return outCanvas;
}
```

Note: The `import type { GuideLine }` should be added to the existing import at the top of the file (line 7):

```typescript
import type { QuadResult, GuideLine } from "./types";
```

And `computeCropDimensions` is already defined later in the file — it will be called by `perspectiveCropPiecewise`. Since it's defined below in the same file, this is fine in TypeScript (function declarations are hoisted, but this is a `function` statement so it works).

- [ ] **Step 4: Verify build**

Run: `npm run build`

- [ ] **Step 5: Commit**

```bash
git add src/lib/crop.ts
git commit -m "feat: add piecewise Coons patch with de Casteljau subdivision"
```

---

### Task 3: Wire Piecewise Crop into EditorScreen

**Files:**
- Modify: `src/components/EditorScreen.tsx:11-12,114-149,255-284`

- [ ] **Step 1: Update imports and cropKey**

In `src/components/EditorScreen.tsx`, update the import (line 11):

```typescript
import { perspectiveCrop, perspectiveCropPiecewise } from "../lib/crop";
```

Update `cropKey` (line 114-119) to include guideLines:

```typescript
  const cropKey = selectedImage?.editState
    ? JSON.stringify({
        corners: selectedImage.editState.corners,
        edgeFits: selectedImage.editState.edgeFits,
        guideLines: selectedImage.editState.guideLines,
      })
    : null;
```

- [ ] **Step 2: Update crop computation to use piecewise when guide lines exist**

Update the crop useEffect (around line 121-149). Replace the `perspectiveCrop` call with a conditional:

```typescript
  useEffect(() => {
    if (isDraggingRef.current) return;
    if (!selectedImage?.editState || !selectedImage.originalCanvas) {
      prevCropKeyRef.current = null;
      return;
    }
    if (cropKey === prevCropKeyRef.current) return;
    prevCropKeyRef.current = cropKey;

    const quadResult = {
      corners: selectedImage.editState.corners,
      edges: selectedImage.initialQuad?.edges ?? [],
      edgeFits: selectedImage.editState.edgeFits,
    };

    const gl = selectedImage.editState.guideLines;
    const cropCanvas = gl.length > 0
      ? perspectiveCropPiecewise(
          selectedImage.originalCanvas,
          quadResult,
          gl,
          selectedImage.maskWidth,
          selectedImage.maskHeight,
        )
      : perspectiveCrop(
          selectedImage.originalCanvas,
          quadResult,
          selectedImage.maskWidth,
          selectedImage.maskHeight,
        );

    dispatch({
      type: "UPDATE_IMAGE",
      id: selectedImage.id,
      updates: { cropCanvas },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cropKey, state.selectedImageId]);
```

- [ ] **Step 3: Update handleDragEnd similarly**

Update `handleDragEnd` (around line 255-284):

```typescript
  const handleDragEnd = useCallback(() => {
    isDraggingRef.current = false;
    const img = getSelectedImage(stateRef.current);
    if (!img?.editState || !img.originalCanvas) return;

    const quadResult = {
      corners: img.editState.corners,
      edges: img.initialQuad?.edges ?? [],
      edgeFits: img.editState.edgeFits,
    };

    const gl = img.editState.guideLines;
    const cropCanvas = gl.length > 0
      ? perspectiveCropPiecewise(
          img.originalCanvas,
          quadResult,
          gl,
          img.maskWidth,
          img.maskHeight,
        )
      : perspectiveCrop(
          img.originalCanvas,
          quadResult,
          img.maskWidth,
          img.maskHeight,
        );

    prevCropKeyRef.current = JSON.stringify({
      corners: img.editState.corners,
      edgeFits: img.editState.edgeFits,
      guideLines: img.editState.guideLines,
    });

    dispatch({
      type: "UPDATE_IMAGE",
      id: img.id,
      updates: { cropCanvas },
    });
  }, [dispatch]);
```

- [ ] **Step 4: Verify build**

Run: `npm run build`

- [ ] **Step 5: Commit**

```bash
git add src/components/EditorScreen.tsx
git commit -m "feat: wire piecewise crop into editor when guide lines exist"
```

---

### Task 4: Guide Line Rendering in QuadEditor

**Files:**
- Modify: `src/components/QuadEditor.tsx:1-522`

This task adds rendering of guide lines and extends the selection model. It does NOT add the creation interaction yet (that's Task 5).

- [ ] **Step 1: Add guide line canvas constants and selection types**

In `src/components/QuadEditor.tsx`, add after line 22 (after `EDGE_HANDLE_GLOW`):

```typescript
const GUIDE_LINE_STROKE = "rgba(245, 158, 11, 0.8)";       // amber
const GUIDE_LINE_STROKE_HOVER = "rgba(245, 158, 11, 1)";
const GUIDE_CP_FILL = "rgba(245, 158, 11, 0.4)";
const GUIDE_CP_FILL_SEL = "rgba(245, 158, 11, 0.7)";
const GUIDE_ENDPOINT_FILL = "rgba(245, 158, 11, 0.5)";
const GUIDE_ENDPOINT_FILL_SEL = "rgba(245, 158, 11, 0.8)";
```

Update the `PointSelection` type in `src/lib/types.ts` (line 105-108) to support guide line handles:

```typescript
export interface PointSelection {
  type: "corner" | "cp1" | "cp2" | "edge" | "guide-left" | "guide-right" | "guide-cp1" | "guide-cp2" | "guide-body";
  edgeIdx: number;  // for quad points: edge index; for guide points: guide line index
}
```

- [ ] **Step 2: Add guide line rendering to the draw function**

In `QuadEditor.tsx`, inside the `draw` callback (after the corners drawing loop, around line 271, before the closing `}, [baseCanvas, ...` of the draw callback), add guide line drawing:

```typescript
    // Draw guide lines
    const { guideLines } = editState;
    const glLw = Math.max(2, Math.round(imgW / 300));
    const glR = Math.max(5, Math.round(imgW / 90));       // endpoint radius
    const glRSel = Math.max(8, Math.round(imgW / 60));
    const glCpR = Math.max(4, Math.round(imgW / 100));    // CP radius
    const glCpRSel = Math.max(7, Math.round(imgW / 70));

    for (let gi = 0; gi < guideLines.length; gi++) {
      const g = guideLines[gi];
      // Compute endpoints from quad L/R edges (in image space)
      // L edge: TL→BL (edgeFits[3] reversed)
      const p0 = evalBezierPt(corners[0], edgeFits[3].cp2, edgeFits[3].cp1, corners[3], g.leftV);
      const p3 = evalBezierPt(corners[1], edgeFits[1].cp1, edgeFits[1].cp2, corners[2], g.rightV);

      // Draw Bezier curve
      ctx.beginPath();
      ctx.moveTo(p0[0] * sx, p0[1] * sy);
      ctx.bezierCurveTo(
        g.cp1[0] * sx, g.cp1[1] * sy,
        g.cp2[0] * sx, g.cp2[1] * sy,
        p3[0] * sx, p3[1] * sy,
      );
      const isBodySel = selected?.type === "guide-body" && selected.edgeIdx === gi;
      ctx.lineWidth = isBodySel ? glLw * 1.5 : glLw;
      ctx.strokeStyle = isBodySel ? GUIDE_LINE_STROKE_HOVER : GUIDE_LINE_STROKE;
      ctx.stroke();

      // Draw CP guide lines (dashed)
      ctx.setLineDash([4, 4]);
      ctx.lineWidth = Math.max(1, glLw / 2);
      ctx.strokeStyle = "rgba(245, 158, 11, 0.3)";
      ctx.beginPath(); ctx.moveTo(p0[0] * sx, p0[1] * sy); ctx.lineTo(g.cp1[0] * sx, g.cp1[1] * sy); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(p3[0] * sx, p3[1] * sy); ctx.lineTo(g.cp2[0] * sx, g.cp2[1] * sy); ctx.stroke();
      ctx.setLineDash([]);

      // Draw CPs (diamonds)
      for (const [cpKey, cp] of [["guide-cp1", g.cp1], ["guide-cp2", g.cp2]] as const) {
        const isSel = selected?.type === cpKey && selected.edgeIdx === gi;
        const r = isSel ? glCpRSel : glCpR;
        const cx = cp[0] * sx, cy = cp[1] * sy;
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(Math.PI / 4);
        ctx.fillStyle = isSel ? GUIDE_CP_FILL_SEL : GUIDE_CP_FILL;
        ctx.fillRect(-r, -r, r * 2, r * 2);
        ctx.strokeStyle = "#fff";
        ctx.lineWidth = Math.max(1, glLw / 3);
        ctx.strokeRect(-r, -r, r * 2, r * 2);
        ctx.restore();
      }

      // Draw endpoints (circles on L/R edges)
      for (const [epKey, ep] of [["guide-left", p0], ["guide-right", p3]] as const) {
        const isSel = selected?.type === epKey && selected.edgeIdx === gi;
        const r = isSel ? glRSel : glR;
        ctx.beginPath();
        ctx.arc(ep[0] * sx, ep[1] * sy, r, 0, 2 * Math.PI);
        ctx.fillStyle = isSel ? GUIDE_ENDPOINT_FILL_SEL : GUIDE_ENDPOINT_FILL;
        ctx.fill();
        ctx.strokeStyle = "#fff";
        ctx.lineWidth = Math.max(1.5, glLw / 2);
        ctx.stroke();
      }
    }
```

We need a helper to evaluate Bezier at a parameter (not arc-length). Add this at the top of the component file, after the imports:

```typescript
import { evalBezier } from "../lib/crop";

// Evaluate Bezier at parameter t (wrapper for draw use)
function evalBezierPt(
  p0: [number, number], cp1: [number, number], cp2: [number, number], p3: [number, number], t: number,
): [number, number] {
  return evalBezier(p0, cp1, cp2, p3, t);
}
```

- [ ] **Step 3: Update getAllPoints for hit detection**

Update `getAllPoints` in QuadEditor to include guide line hit targets. After the edge midpoints loop (around line 294), add:

```typescript
    // Guide line hit targets
    for (let gi = 0; gi < editState.guideLines.length; gi++) {
      const g = editState.guideLines[gi];
      const p0 = evalBezierPt(editState.corners[0], editState.edgeFits[3].cp2, editState.edgeFits[3].cp1, editState.corners[3], g.leftV);
      const p3 = evalBezierPt(editState.corners[1], editState.edgeFits[1].cp1, editState.edgeFits[1].cp2, editState.corners[2], g.rightV);

      // Endpoints
      pts.push({ type: "guide-left", edgeIdx: gi, pos: p0 });
      pts.push({ type: "guide-right", edgeIdx: gi, pos: p3 });
      // Control points
      pts.push({ type: "guide-cp1", edgeIdx: gi, pos: g.cp1 });
      pts.push({ type: "guide-cp2", edgeIdx: gi, pos: g.cp2 });
      // Body (midpoint of curve for hit)
      const mid = evalBezierPt(p0, g.cp1, g.cp2, p3, 0.5);
      pts.push({ type: "guide-body", edgeIdx: gi, pos: mid });
    }
```

Update the type of `pts` array to match the expanded `PointSelection`:

```typescript
    const pts: { type: PointSelection["type"]; edgeIdx: number; pos: [number, number] }[] = [];
```

- [ ] **Step 4: Update handlePointerMove to support guide line dragging**

In the `handlePointerMove` callback, after the existing `cp1/cp2` branch (after line 463), add cases for guide line types:

```typescript
      } else if (type === "guide-body") {
        // Move entire guide line vertically (adjust leftV and rightV)
        const gi = edgeIdx;
        const g = editState.guideLines[gi];
        // Compute current midpoint y and desired delta
        const p0 = evalBezierPt(editState.corners[0], editState.edgeFits[3].cp2, editState.edgeFits[3].cp1, editState.corners[3], g.leftV);
        const p3 = evalBezierPt(editState.corners[1], editState.edgeFits[1].cp1, editState.edgeFits[1].cp2, editState.corners[2], g.rightV);
        const midY = (p0[1] + p3[1]) / 2;
        const deltaY = my - midY;

        // Approximate new V values by offsetting
        const lRange = Math.hypot(editState.corners[3][0] - editState.corners[0][0], editState.corners[3][1] - editState.corners[0][1]);
        const rRange = Math.hypot(editState.corners[2][0] - editState.corners[1][0], editState.corners[2][1] - editState.corners[1][1]);
        const deltaLV = deltaY / (lRange || 1);
        const deltaRV = deltaY / (rRange || 1);

        const newLeftV = Math.max(0.01, Math.min(0.99, g.leftV + deltaLV));
        const newRightV = Math.max(0.01, Math.min(0.99, g.rightV + deltaRV));

        const newP0 = evalBezierPt(editState.corners[0], editState.edgeFits[3].cp2, editState.edgeFits[3].cp1, editState.corners[3], newLeftV);
        const newP3 = evalBezierPt(editState.corners[1], editState.edgeFits[1].cp1, editState.edgeFits[1].cp2, editState.corners[2], newRightV);

        // Move control points by the same delta
        const guideLines = editState.guideLines.map((gl, i) => i === gi ? {
          leftV: newLeftV,
          rightV: newRightV,
          cp1: [g.cp1[0] + (newP0[0] - p0[0]), g.cp1[1] + (newP0[1] - p0[1])] as [number, number],
          cp2: [g.cp2[0] + (newP3[0] - p3[0]), g.cp2[1] + (newP3[1] - p3[1])] as [number, number],
        } : { ...gl });

        dispatch({
          type: "SET_EDIT_STATE",
          id: selectedImage.id,
          editState: { ...editState, guideLines },
        });
      } else if (type === "guide-left" || type === "guide-right") {
        // Slide endpoint along L or R quad edge
        const gi = edgeIdx;
        const g = editState.guideLines[gi];
        const isLeft = type === "guide-left";

        // Find closest v on the edge to the mouse position
        const edgePts = isLeft
          ? { p0: editState.corners[0], cp1: editState.edgeFits[3].cp2, cp2: editState.edgeFits[3].cp1, p3: editState.corners[3] }
          : { p0: editState.corners[1], cp1: editState.edgeFits[1].cp1, cp2: editState.edgeFits[1].cp2, p3: editState.corners[2] };

        // Binary search for closest point on edge
        let bestV = isLeft ? g.leftV : g.rightV;
        let bestDist = Infinity;
        for (let step = 0; step < 50; step++) {
          const v = step / 49;
          const pt = evalBezierPt(edgePts.p0, edgePts.cp1, edgePts.cp2, edgePts.p3, v);
          const d = Math.hypot(pt[0] - mx, pt[1] - my);
          if (d < bestDist) { bestDist = d; bestV = v; }
        }
        bestV = Math.max(0.01, Math.min(0.99, bestV));

        const guideLines = editState.guideLines.map((gl, i) => {
          if (i !== gi) return { ...gl };
          return isLeft
            ? { ...gl, leftV: bestV }
            : { ...gl, rightV: bestV };
        });

        dispatch({
          type: "SET_EDIT_STATE",
          id: selectedImage.id,
          editState: { ...editState, guideLines },
        });
      } else if (type === "guide-cp1" || type === "guide-cp2") {
        const gi = edgeIdx;
        const cpKey = type === "guide-cp1" ? "cp1" : "cp2";
        const guideLines = editState.guideLines.map((gl, i) => {
          if (i !== gi) return { ...gl };
          return { ...gl, [cpKey]: clampToContainer(mx, my) };
        });
        dispatch({
          type: "SET_EDIT_STATE",
          id: selectedImage.id,
          editState: { ...editState, guideLines },
        });
      }
```

- [ ] **Step 5: Verify build**

Run: `npm run build`

- [ ] **Step 6: Commit**

```bash
git add src/components/QuadEditor.tsx src/lib/types.ts
git commit -m "feat: render guide lines in QuadEditor with drag interaction"
```

---

### Task 5: Guide Line Creation + ToolPanel UI

**Files:**
- Modify: `src/components/QuadEditor.tsx` (Props, add-mode interaction)
- Modify: `src/components/EditorScreen.tsx` (guideAddMode state, pass to QuadEditor)
- Modify: `src/components/ToolPanel.tsx` (Guide Lines section)

- [ ] **Step 1: Add guideAddMode state to EditorScreen**

In `src/components/EditorScreen.tsx`, add state for guide add mode (after `previewBg` state, around line 36):

```typescript
  const [guideAddMode, setGuideAddMode] = useState(false);
  const [guideAddStep, setGuideAddStep] = useState<"left" | "right" | null>(null);
  const [pendingLeftV, setPendingLeftV] = useState<number | null>(null);
```

Exit guide-add mode when switching images (add to the existing useEffect that resets eraserActive):

```typescript
  useEffect(() => {
    setEraserActive(false);
    setGuideAddMode(false);
    setGuideAddStep(null);
    setPendingLeftV(null);
  }, [state.selectedImageId, currentFilterType]);
```

- [ ] **Step 2: Update QuadEditor Props and pass add-mode state**

In `src/components/QuadEditor.tsx`, update the Props interface:

```typescript
interface Props {
  onDragStart: () => void;
  onDragEnd: () => void;
  guideAddMode: boolean;
  guideAddStep: "left" | "right" | null;
  pendingLeftV: number | null;
  onGuideAddClick: (mx: number, my: number) => void;
}
```

Update the component to destructure these:

```typescript
export default function QuadEditor({ onDragStart, onDragEnd, guideAddMode, guideAddStep, pendingLeftV, onGuideAddClick }: Props) {
```

In `EditorScreen.tsx`, pass these to `QuadEditor`:

```typescript
            <QuadEditor
              onDragStart={handleDragStart}
              onDragEnd={handleDragEnd}
              guideAddMode={guideAddMode}
              guideAddStep={guideAddStep ?? null}
              pendingLeftV={pendingLeftV ?? null}
              onGuideAddClick={handleGuideAddClick}
            />
```

- [ ] **Step 3: Add handleGuideAddClick to EditorScreen**

In `EditorScreen.tsx`, add the handler (after `handleDragEnd`):

```typescript
  const handleGuideAddClick = useCallback((mx: number, my: number) => {
    const img = getSelectedImage(stateRef.current);
    if (!img?.editState) return;
    const es = img.editState;

    if (guideAddStep === null || guideAddStep === "left") {
      // Find closest v on L edge
      const lEdge = { p0: es.corners[0], cp1: es.edgeFits[3].cp2, cp2: es.edgeFits[3].cp1, p3: es.corners[3] };
      let bestV = 0.5, bestDist = Infinity;
      for (let step = 0; step < 50; step++) {
        const v = step / 49;
        const pt = evalBezier(lEdge.p0, lEdge.cp1, lEdge.cp2, lEdge.p3, v);
        const d = Math.hypot(pt[0] - mx, pt[1] - my);
        if (d < bestDist) { bestDist = d; bestV = v; }
      }
      setPendingLeftV(Math.max(0.01, Math.min(0.99, bestV)));
      setGuideAddStep("right");
    } else if (guideAddStep === "right" && pendingLeftV !== null) {
      // Find closest v on R edge
      const rEdge = { p0: es.corners[1], cp1: es.edgeFits[1].cp1, cp2: es.edgeFits[1].cp2, p3: es.corners[2] };
      let bestV = 0.5, bestDist = Infinity;
      for (let step = 0; step < 50; step++) {
        const v = step / 49;
        const pt = evalBezier(rEdge.p0, rEdge.cp1, rEdge.cp2, rEdge.p3, v);
        const d = Math.hypot(pt[0] - mx, pt[1] - my);
        if (d < bestDist) { bestDist = d; bestV = v; }
      }
      const rightV = Math.max(0.01, Math.min(0.99, bestV));

      // Create the guide line
      const p0 = evalBezier(lEdge.p0, lEdge.cp1, lEdge.cp2, lEdge.p3, pendingLeftV);
      const rEdge2 = { p0: es.corners[1], cp1: es.edgeFits[1].cp1, cp2: es.edgeFits[1].cp2, p3: es.corners[2] };
      const p3 = evalBezier(rEdge2.p0, rEdge2.cp1, rEdge2.cp2, rEdge2.p3, rightV);

      const newGuide: GuideLine = {
        leftV: pendingLeftV,
        rightV,
        cp1: [p0[0] + (p3[0] - p0[0]) / 3, p0[1] + (p3[1] - p0[1]) / 3],
        cp2: [p0[0] + 2 * (p3[0] - p0[0]) / 3, p0[1] + 2 * (p3[1] - p0[1]) / 3],
      };

      dispatch({ type: "PUSH_HISTORY", id: img.id });
      const guideLines = [...es.guideLines, newGuide].sort(
        (a, b) => (a.leftV + a.rightV) / 2 - (b.leftV + b.rightV) / 2,
      );
      dispatch({
        type: "SET_EDIT_STATE",
        id: img.id,
        editState: { ...es, guideLines },
      });

      // Reset add mode
      setGuideAddStep(null);
      setPendingLeftV(null);
      setGuideAddMode(false);
    }
  }, [guideAddStep, pendingLeftV, dispatch]);
```

Add the import for `evalBezier` and `GuideLine` at the top of `EditorScreen.tsx`:

```typescript
import { perspectiveCrop, perspectiveCropPiecewise, evalBezier } from "../lib/crop";
import type { AppState, GuideLine } from "../lib/types";
```

- [ ] **Step 4: Handle add-mode clicks in QuadEditor**

In `QuadEditor.tsx`'s `handlePointerDown`, add at the top (before the normal hit detection):

```typescript
      if (guideAddMode) {
        onGuideAddClick(mx, my);
        return;
      }
```

Update the canvas cursor style to reflect add mode:

```typescript
        style={{
          cursor: guideAddMode
            ? "crosshair"
            : dragging
              ? selected?.type === "edge"
                ? (selected.edgeIdx === 0 || selected.edgeIdx === 2 ? "ns-resize" : "ew-resize")
                : "grabbing"
              : "pointer",
```

- [ ] **Step 5: Add Guide Lines section to ToolPanel**

In `src/components/ToolPanel.tsx`, update the Props to receive guide-related callbacks:

```typescript
export default function ToolPanel({
  eraserActive, onToggleEraser, eraserTool, onSetEraserTool, brushSize, onSetBrushSize,
  guideAddMode, onToggleGuideAdd, onClearGuides,
}: {
  eraserActive: boolean; onToggleEraser: () => void;
  eraserTool: "brush" | "lasso"; onSetEraserTool: (tool: "brush" | "lasso") => void;
  brushSize: number; onSetBrushSize: (size: number) => void;
  guideAddMode: boolean; onToggleGuideAdd: () => void;
  onClearGuides: () => void;
}) {
```

Add a guide line icon (after the existing icons at the top of the file):

```typescript
function IconGuide() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <path d="M3 12Q12 6 21 12" />
      <circle cx="3" cy="12" r="1.5" fill="currentColor" />
      <circle cx="21" cy="12" r="1.5" fill="currentColor" />
    </svg>
  );
}
```

Add the Guide Lines section before the Edge Curves section (before the `{/* Edge Curves — spatial layout */}` comment):

```typescript
      {/* Guide Lines */}
      <div className="h-px bg-[var(--border)]" />
      <div>
        <SectionHeader title="Guide Lines" />
        <div className="flex flex-col gap-1">
          <Btn
            icon={<IconGuide />}
            label={guideAddMode ? "Click L then R edge" : "+ Add Guide"}
            onClick={onToggleGuideAdd}
            disabled={!hasCrop}
            active={guideAddMode}
          />
          {(sel?.editState?.guideLines?.length ?? 0) > 0 && (
            <>
              <div className="flex items-center justify-between px-1">
                <span className="text-[10px] text-[var(--text-muted)]">
                  {sel?.editState?.guideLines?.length ?? 0} guide line{(sel?.editState?.guideLines?.length ?? 0) !== 1 ? "s" : ""}
                </span>
                <button
                  className="text-[10px] text-[var(--text-muted)] hover:text-[var(--danger)] transition-colors"
                  onClick={onClearGuides}
                >
                  Clear
                </button>
              </div>
            </>
          )}
        </div>
      </div>
```

- [ ] **Step 6: Wire ToolPanel guide props in EditorScreen**

In `EditorScreen.tsx`, add the clear handler and pass props to ToolPanel:

```typescript
  const handleClearGuides = useCallback(() => {
    const img = getSelectedImage(stateRef.current);
    if (!img?.editState || img.editState.guideLines.length === 0) return;
    dispatch({ type: "PUSH_HISTORY", id: img.id });
    dispatch({
      type: "SET_EDIT_STATE",
      id: img.id,
      editState: { ...img.editState, guideLines: [] },
    });
  }, [dispatch]);
```

Update ToolPanel usage:

```typescript
        <ToolPanel
          eraserActive={eraserActive}
          onToggleEraser={() => setEraserActive((v) => !v)}
          eraserTool={eraserTool}
          onSetEraserTool={setEraserTool}
          brushSize={brushSize}
          onSetBrushSize={setBrushSize}
          guideAddMode={guideAddMode}
          onToggleGuideAdd={() => {
            setGuideAddMode((v) => !v);
            setGuideAddStep(v => v ? null : "left");
            setPendingLeftV(null);
          }}
          onClearGuides={handleClearGuides}
        />
```

- [ ] **Step 7: Add Delete key handler for guide lines**

In `EditorScreen.tsx`, in the keyboard handler useEffect (around line 45), add Delete/Backspace handling for selected guide lines. This requires the QuadEditor to expose its selection state. A simpler approach: handle it in QuadEditor's `handlePointerDown` already handles selection — add a keyboard listener in QuadEditor for Delete:

In `QuadEditor.tsx`, add a useEffect for keyboard:

```typescript
  // Delete guide line with Delete/Backspace key
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (!selected || !editState || !selectedImage) return;
      if (e.key !== "Delete" && e.key !== "Backspace") return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;

      if (selected.type.startsWith("guide-")) {
        e.preventDefault();
        const gi = selected.edgeIdx;
        dispatch({ type: "PUSH_HISTORY", id: selectedImage.id });
        const guideLines = editState.guideLines.filter((_, i) => i !== gi);
        dispatch({
          type: "SET_EDIT_STATE",
          id: selectedImage.id,
          editState: { ...editState, guideLines },
        });
        setSelected(null);
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [selected, editState, selectedImage, dispatch]);
```

- [ ] **Step 8: Verify build**

Run: `npm run build`

- [ ] **Step 9: Commit**

```bash
git add src/components/QuadEditor.tsx src/components/EditorScreen.tsx src/components/ToolPanel.tsx
git commit -m "feat: guide line creation UI and ToolPanel controls"
```

---

### Task 6: Build, Lint, Final Verification

**Files:** All modified files

- [ ] **Step 1: Full build**

Run: `npm run build`

- [ ] **Step 2: Lint**

Run: `npm run lint`

Fix any lint errors.

- [ ] **Step 3: Verify type consistency**

Check that all references to `GuideLine`, `guideLines`, `evalBezier`, `perspectiveCropPiecewise`, `subBezier` are consistent across files.

- [ ] **Step 4: Final commit (if lint fixes needed)**

```bash
git add -A
git commit -m "fix: lint and type fixes for staff guide lines"
```
