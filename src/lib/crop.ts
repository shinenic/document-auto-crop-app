/**
 * Perspective crop — faithful port from demo/src/lib/segmentation.js
 *
 * perspectiveCrop: Coons patch with arc-length parameterized Bezier boundaries
 * perspectiveHomography: Standard 4-point homography (straight edges only)
 */
import type { QuadResult, DewarpGuide, AlignGuide } from "./types";

// ─── Bezier evaluation ──────────────────────────────────────────────────────

export function evalBezier(
  p0: [number, number],
  cp1: [number, number],
  cp2: [number, number],
  p3: [number, number],
  t: number,
): [number, number] {
  const omt = 1 - t;
  return [
    omt * omt * omt * p0[0] +
      3 * omt * omt * t * cp1[0] +
      3 * omt * t * t * cp2[0] +
      t * t * t * p3[0],
    omt * omt * omt * p0[1] +
      3 * omt * omt * t * cp1[1] +
      3 * omt * t * t * cp2[1] +
      t * t * t * p3[1],
  ];
}

// ─── Arc-length parameterization ────────────────────────────────────────────

function buildArcLengthTable(
  p0: [number, number],
  cp1: [number, number],
  cp2: [number, number],
  p3: [number, number],
  steps = 200,
): Float64Array {
  const table = new Float64Array(steps + 1);
  let prev = p0;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const curr = evalBezier(p0, cp1, cp2, p3, t);
    table[i] =
      table[i - 1] + Math.hypot(curr[0] - prev[0], curr[1] - prev[1]);
    prev = curr;
  }
  return table;
}

function arcLengthToT(table: Float64Array, u: number): number {
  const target = u * table[table.length - 1];
  let lo = 0,
    hi = table.length - 1;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if (table[mid] < target) lo = mid;
    else hi = mid;
  }
  const seg = table[hi] - table[lo];
  const frac = seg > 1e-10 ? (target - table[lo]) / seg : 0;
  return (lo + frac) / (table.length - 1);
}

export function makeArcLengthEval(
  p0: [number, number],
  cp1: [number, number],
  cp2: [number, number],
  p3: [number, number],
): (u: number) => [number, number] {
  const table = buildArcLengthTable(p0, cp1, cp2, p3);
  return (u: number) =>
    evalBezier(p0, cp1, cp2, p3, arcLengthToT(table, u));
}

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
  const { right: after } = splitBezier(p0, cp1, cp2, p3, tStart);
  const tMapped = (tEnd - tStart) / (1 - tStart);
  const { left } = splitBezier(after[0], after[1], after[2], after[3], tMapped);
  return left;
}

// ─── Guide line extrapolation ──────────────────────────────────────────────

type Pt = [number, number];
type BezierPts = [Pt, Pt, Pt, Pt];

/** Find closest v-parameter on a Bezier edge to a given point. */
function projectToEdge(
  edgePts: BezierPts, target: Pt, samples = 80,
): number {
  let bestV = 0, bestDist = Infinity;
  for (let i = 0; i <= samples; i++) {
    const v = i / samples;
    const pt = evalBezier(edgePts[0], edgePts[1], edgePts[2], edgePts[3], v);
    const d = Math.hypot(pt[0] - target[0], pt[1] - target[1]);
    if (d < bestDist) { bestDist = d; bestV = v; }
  }
  return Math.max(0.001, Math.min(0.999, bestV));
}

/**
 * Build a C1-continuous extension Bezier from edgePt to guidePt,
 * matching the guide curve's tangent direction at guidePt.
 * tanDir = direction from guidePt INTO the curve (towards the other cp).
 */
function buildExtensionBezier(
  edgePt: Pt, guidePt: Pt, tanDir: Pt,
): BezierPts {
  const dist = Math.hypot(edgePt[0] - guidePt[0], edgePt[1] - guidePt[1]);
  const tanLen = Math.hypot(tanDir[0], tanDir[1]) || 1;
  // Extension cp near guidePt: reflect tangent for C1 continuity
  const k = dist / (3 * tanLen);
  const extCp2: Pt = [guidePt[0] - tanDir[0] * k, guidePt[1] - tanDir[1] * k];
  // Extension cp near edgePt: straight-line default
  const extCp1: Pt = [edgePt[0] + (guidePt[0] - edgePt[0]) / 3, edgePt[1] + (guidePt[1] - edgePt[1]) / 3];
  return [edgePt, extCp1, extCp2, guidePt];
}

/**
 * Create arc-length evaluator for a composite of multiple Bezier segments.
 * Traverses all segments continuously from u=0 to u=1.
 */
function makeCompositeArcLengthEval(
  segments: BezierPts[],
): (u: number) => Pt {
  const tables = segments.map(([a, b, c, d]) => buildArcLengthTable(a, b, c, d));
  const lengths = tables.map(t => t[t.length - 1]);
  const totalLength = lengths.reduce((a, b) => a + b, 0);
  if (totalLength < 1e-10) {
    return () => segments[0][0];
  }
  return (u: number) => {
    const target = u * totalLength;
    let accumulated = 0;
    for (let i = 0; i < segments.length; i++) {
      if (accumulated + lengths[i] >= target || i === segments.length - 1) {
        const localU = lengths[i] > 1e-10 ? (target - accumulated) / lengths[i] : 0;
        const localT = arcLengthToT(tables[i], localU);
        return evalBezier(segments[i][0], segments[i][1], segments[i][2], segments[i][3], localT);
      }
      accumulated += lengths[i];
    }
    const last = segments[segments.length - 1];
    return last[3]; // end of last segment
  };
}

/**
 * Extrapolate a guide line (whose endpoints are freely placed inside the quad)
 * to the quad's L/R edges. Returns:
 * - leftV, rightV: v-parameters on the L/R edges
 * - eval: arc-length evaluator for the full-width composite curve
 * - leftPt, rightPt: actual intersection points on L/R edges
 */
function extrapolateGuide(
  g: DewarpGuide,
  Lraw: BezierPts,
  Rraw: BezierPts,
): { leftV: number; rightV: number; eval: (u: number) => Pt; leftPt: Pt; rightPt: Pt } {
  // Project endpoints onto L/R edges
  const leftV = projectToEdge(Lraw, g.p0);
  const rightV = projectToEdge(Rraw, g.p3);
  const leftPt = evalBezier(Lraw[0], Lraw[1], Lraw[2], Lraw[3], leftV);
  const rightPt = evalBezier(Rraw[0], Rraw[1], Rraw[2], Rraw[3], rightV);

  // Tangent directions at endpoints (pointing into the curve)
  const tanLeft: Pt = [g.cp1[0] - g.p0[0], g.cp1[1] - g.p0[1]];
  const tanRight: Pt = [g.p3[0] - g.cp2[0], g.p3[1] - g.cp2[1]];

  // Build extension Beziers
  const extLeft = buildExtensionBezier(leftPt, g.p0, tanLeft);
  const extRight: BezierPts = (() => {
    const dist = Math.hypot(rightPt[0] - g.p3[0], rightPt[1] - g.p3[1]);
    const tanLen = Math.hypot(tanRight[0], tanRight[1]) || 1;
    const k = dist / (3 * tanLen);
    const cp1: Pt = [g.p3[0] + tanRight[0] * k, g.p3[1] + tanRight[1] * k];
    const cp2: Pt = [rightPt[0] - (rightPt[0] - g.p3[0]) / 3, rightPt[1] - (rightPt[1] - g.p3[1]) / 3];
    return [g.p3, cp1, cp2, rightPt];
  })();

  // Composite: extLeft + main curve + extRight
  const mainCurve: BezierPts = [g.p0, g.cp1, g.cp2, g.p3];
  // Skip extensions if endpoint is very close to edge (< 1px)
  const segments: BezierPts[] = [];
  if (Math.hypot(leftPt[0] - g.p0[0], leftPt[1] - g.p0[1]) > 0.5) {
    segments.push(extLeft);
  }
  segments.push(mainCurve);
  if (Math.hypot(rightPt[0] - g.p3[0], rightPt[1] - g.p3[1]) > 0.5) {
    segments.push(extRight);
  }

  return {
    leftV,
    rightV,
    eval: makeCompositeArcLengthEval(segments),
    leftPt,
    rightPt,
  };
}

// ─── Arc-length interpolation on a precomputed table ───────────────────────

function arcLengthAt(table: Float64Array, t: number): number {
  const idx = t * (table.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.min(lo + 1, table.length - 1);
  if (lo === hi) return table[lo];
  return table[lo] + (table[hi] - table[lo]) * (idx - lo);
}

// ─── Align guide extrapolation ─────────────────────────────────────────────

/** Find u-parameter on a horizontal curve closest to a given point. */
function projectToHCurve(
  curveEval: (u: number) => Pt, target: Pt, samples = 80,
): number {
  let bestU = 0.5, bestDist = Infinity;
  for (let i = 0; i <= samples; i++) {
    const u = i / samples;
    const pt = curveEval(u);
    const d = Math.hypot(pt[0] - target[0], pt[1] - target[1]);
    if (d < bestDist) { bestDist = d; bestU = u; }
  }
  return Math.max(0.001, Math.min(0.999, bestU));
}

/** Find u-parameter where a horizontal curve crosses a straight line (A→B). */
function findLineCurveU(
  curveEval: (u: number) => Pt, lineA: Pt, lineB: Pt, samples = 200,
): number {
  const dx = lineB[0] - lineA[0], dy = lineB[1] - lineA[1];
  let prevCross = 0;
  for (let i = 0; i <= samples; i++) {
    const u = i / samples;
    const p = curveEval(u);
    const cross = dx * (p[1] - lineA[1]) - dy * (p[0] - lineA[0]);
    if (i > 0 && prevCross * cross <= 0 && (Math.abs(prevCross) + Math.abs(cross) > 1e-12)) {
      // Sign change — bisect
      let lo = (i - 1) / samples, hi = u;
      for (let j = 0; j < 20; j++) {
        const mid = (lo + hi) / 2;
        const mp = curveEval(mid);
        const mc = dx * (mp[1] - lineA[1]) - dy * (mp[0] - lineA[0]);
        if (mc * prevCross > 0) lo = mid; else hi = mid;
      }
      return (lo + hi) / 2;
    }
    prevCross = cross;
  }
  // No crossing found — project closest point
  let bestU = 0.5, bestDist = Infinity;
  for (let i = 0; i <= samples; i++) {
    const u = i / samples;
    const p = curveEval(u);
    // Distance to infinite line
    const len2 = dx * dx + dy * dy;
    const t = len2 > 0 ? ((p[0] - lineA[0]) * dx + (p[1] - lineA[1]) * dy) / len2 : 0;
    const proj: Pt = [lineA[0] + t * dx, lineA[1] + t * dy];
    const d = Math.hypot(p[0] - proj[0], p[1] - proj[1]);
    if (d < bestDist) { bestDist = d; bestU = u; }
  }
  return bestU;
}

// ─── Piecewise 2D Coons patch crop ────────────────────────────────────────

/**
 * 2D piecewise Coons patch: dewarp guides split into rows, align guides split into columns.
 * Dewarp guide endpoints are extrapolated to L/R edges; align guide endpoints to T/B edges.
 * Each cell in the grid gets an independent Coons patch.
 *
 * Key invariants:
 * - Dewarp guide curves map to horizontal lines in output (row boundaries)
 * - Align guide lines map to vertical lines in output (column boundaries)
 * - Row heights ∝ arc-length along L/R edges
 * - Column widths ∝ arc-length along T/B edges
 */
export function perspectiveCropPiecewise(
  originalCanvas: HTMLCanvasElement,
  quadResult: QuadResult,
  dewarpGuides: DewarpGuide[],
  alignGuides: AlignGuide[],
  maskWidth: number,
  maskHeight: number,
  maxSize?: number,
): HTMLCanvasElement | null {
  const { corners, edgeFits } = quadResult;
  const imgW = originalCanvas.width, imgH = originalCanvas.height;
  const sX = imgW / maskWidth, sY = imgH / maskHeight;

  const P00 = corners[0], P10 = corners[1], P11 = corners[2], P01 = corners[3];

  // Edge curves: L(TL→BL), R(TR→BR), T(TL→TR), B(BL→BR)
  const Lraw: BezierPts = [P00, edgeFits[3].cp2, edgeFits[3].cp1, P01];
  const Rraw: BezierPts = [P10, edgeFits[1].cp1, edgeFits[1].cp2, P11];
  const Traw: BezierPts = [P00, edgeFits[0].cp1, edgeFits[0].cp2, P10];
  const Braw: BezierPts = [P01, edgeFits[2].cp2, edgeFits[2].cp1, P11];

  // ─── Horizontal boundaries (rows) ───────────────────────────────────────
  interface HBoundary {
    leftV: number;
    rightV: number;
    eval: (u: number) => Pt;
    leftPt: Pt;
    rightPt: Pt;
  }

  const hBounds: HBoundary[] = [];

  // Top edge
  const topEval = makeArcLengthEval(Traw[0], Traw[1], Traw[2], Traw[3]);
  hBounds.push({ leftV: 0, rightV: 0, eval: topEval, leftPt: P00, rightPt: P10 });

  // Dewarp guides (extrapolated to L/R edges)
  if (dewarpGuides.length > 0) {
    const extrapolated = dewarpGuides.map(g => extrapolateGuide(g, Lraw, Rraw));
    const sorted = [...extrapolated].sort((a, b) => (a.leftV + a.rightV) / 2 - (b.leftV + b.rightV) / 2);
    for (const g of sorted) {
      hBounds.push({ leftV: g.leftV, rightV: g.rightV, eval: g.eval, leftPt: g.leftPt, rightPt: g.rightPt });
    }
  }

  // Bottom edge
  const botEval = makeArcLengthEval(Braw[0], Braw[1], Braw[2], Braw[3]);
  hBounds.push({ leftV: 1, rightV: 1, eval: botEval, leftPt: P01, rightPt: P11 });

  // ─── Vertical boundaries (columns) ─────────────────────────────────────
  interface VBoundary {
    topU: number;
    botU: number;
    topPt: Pt;
    botPt: Pt;
  }

  const vBounds: VBoundary[] = [];

  // Left edge
  vBounds.push({ topU: 0, botU: 0, topPt: P00, botPt: P01 });

  // Align guides (extrapolated to T/B edges)
  if (alignGuides.length > 0) {
    const topArcEval = makeArcLengthEval(Traw[0], Traw[1], Traw[2], Traw[3]);
    const botArcEval = makeArcLengthEval(Braw[0], Braw[1], Braw[2], Braw[3]);
    const projected = alignGuides.map(g => {
      // Find where the LINE through p0→p1 intersects the top/bottom edges
      // (not closest-point projection, which would miss the true line direction)
      const topU = findLineCurveU(topArcEval, g.p0, g.p1);
      const botU = findLineCurveU(botArcEval, g.p0, g.p1);
      const topPt = topArcEval(topU);
      const botPt = botArcEval(botU);
      return { topU, botU, topPt, botPt };
    });
    projected.sort((a, b) => (a.topU + a.botU) / 2 - (b.topU + b.botU) / 2);
    for (const g of projected) vBounds.push(g);
  }

  // Right edge
  vBounds.push({ topU: 1, botU: 1, topPt: P10, botPt: P11 });

  // ─── Output dimensions ─────────────────────────────────────────────────
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

  // ─── Row heights (arc-length along L/R edges) ─────────────────────────
  const leftArcTable = buildArcLengthTable(Lraw[0], Lraw[1], Lraw[2], Lraw[3]);
  const rightArcTable = buildArcLengthTable(Rraw[0], Rraw[1], Rraw[2], Rraw[3]);
  const numRows = hBounds.length - 1;
  const rowWeights: number[] = [];
  for (let i = 0; i < numRows; i++) {
    const lLen = arcLengthAt(leftArcTable, hBounds[i + 1].leftV) - arcLengthAt(leftArcTable, hBounds[i].leftV);
    const rLen = arcLengthAt(rightArcTable, hBounds[i + 1].rightV) - arcLengthAt(rightArcTable, hBounds[i].rightV);
    rowWeights.push(Math.max((lLen + rLen) / 2, 0.001));
  }
  const totalRowWeight = rowWeights.reduce((a, b) => a + b, 0);
  const rowHeights: number[] = [];
  let allocH = 0;
  for (let i = 0; i < numRows; i++) {
    const h = i < numRows - 1 ? Math.max(1, Math.round((rowWeights[i] / totalRowWeight) * outH)) : Math.max(1, outH - allocH);
    rowHeights.push(h);
    allocH += h;
  }

  // ─── Column widths (arc-length along T/B edges) ───────────────────────
  // topU/botU are arc-length-parameterized u values, so arc length between
  // u1 and u2 is simply (u2 - u1) * totalLength — no table lookup needed.
  const totalTopLen = buildArcLengthTable(Traw[0], Traw[1], Traw[2], Traw[3])[200];
  const totalBotLen = buildArcLengthTable(Braw[0], Braw[1], Braw[2], Braw[3])[200];
  const numCols = vBounds.length - 1;
  const colWeights: number[] = [];
  for (let j = 0; j < numCols; j++) {
    const tLen = (vBounds[j + 1].topU - vBounds[j].topU) * totalTopLen;
    const bLen = (vBounds[j + 1].botU - vBounds[j].botU) * totalBotLen;
    colWeights.push(Math.max((tLen + bLen) / 2, 0.001));
  }
  const totalColWeight = colWeights.reduce((a, b) => a + b, 0);
  const colWidths: number[] = [];
  let allocW = 0;
  for (let j = 0; j < numCols; j++) {
    const w = j < numCols - 1 ? Math.max(1, Math.round((colWeights[j] / totalColWeight) * outW)) : Math.max(1, outW - allocW);
    colWidths.push(w);
    allocW += w;
  }

  // ─── For each h-boundary, find where each v-boundary crosses it ──────
  // crossU[row][col] = u-parameter on hBounds[row] where vBounds[col] crosses
  // crossPt[row][col] = the actual point
  const crossU: number[][] = [];
  const crossPt: Pt[][] = [];
  for (let ri = 0; ri < hBounds.length; ri++) {
    const hb = hBounds[ri];
    const uRow: number[] = [];
    const ptRow: Pt[] = [];
    for (let ci = 0; ci < vBounds.length; ci++) {
      const vb = vBounds[ci];
      if (ci === 0) {
        // Left edge: u=0
        uRow.push(0);
        ptRow.push(hb.leftPt);
      } else if (ci === vBounds.length - 1) {
        // Right edge: u=1
        uRow.push(1);
        ptRow.push(hb.rightPt);
      } else {
        // Find where align guide line (topPt→botPt) crosses this h-boundary
        const u = findLineCurveU(hb.eval, vb.topPt, vb.botPt);
        uRow.push(u);
        ptRow.push(hb.eval(u));
      }
    }
    crossU.push(uRow);
    crossPt.push(ptRow);
  }

  // ─── For each v-boundary, find where each h-boundary crosses it ──────
  // For left/right edges, use leftV/rightV directly.
  // For align guides, we need the v-parameter along the straight line.
  // crossV[col][row] = parameter along v-boundary col at h-boundary row
  const crossV: number[][] = [];
  for (let ci = 0; ci < vBounds.length; ci++) {
    const vRow: number[] = [];
    for (let ri = 0; ri < hBounds.length; ri++) {
      if (ci === 0) {
        vRow.push(hBounds[ri].leftV);
      } else if (ci === vBounds.length - 1) {
        vRow.push(hBounds[ri].rightV);
      } else {
        // Parameter along the straight line from topPt to botPt
        const vb = vBounds[ci];
        const pt = crossPt[ri][ci];
        const dx = vb.botPt[0] - vb.topPt[0], dy = vb.botPt[1] - vb.topPt[1];
        const len2 = dx * dx + dy * dy;
        const t = len2 > 0 ? ((pt[0] - vb.topPt[0]) * dx + (pt[1] - vb.topPt[1]) * dy) / len2 : 0;
        vRow.push(Math.max(0, Math.min(1, t)));
      }
    }
    crossV.push(vRow);
  }

  // ─── Render cells ─────────────────────────────────────────────────────
  const srcData = originalCanvas.getContext("2d")!.getImageData(0, 0, imgW, imgH);
  const outCanvas = document.createElement("canvas");
  outCanvas.width = outW;
  outCanvas.height = outH;
  const outCtx = outCanvas.getContext("2d")!;
  const outData = outCtx.createImageData(outW, outH);

  let yOff = 0;
  for (let ri = 0; ri < numRows; ri++) {
    const cellH = rowHeights[ri];
    let xOff = 0;
    for (let ci = 0; ci < numCols; ci++) {
      const cellW = colWidths[ci];

      // 4 corner points of this cell
      const cP00 = crossPt[ri][ci];
      const cP10 = crossPt[ri][ci + 1];
      const cP01 = crossPt[ri + 1][ci];
      const cP11 = crossPt[ri + 1][ci + 1];

      // Top boundary: sub-curve of hBounds[ri] from crossU[ri][ci] to crossU[ri][ci+1]
      const topU0 = crossU[ri][ci], topU1 = crossU[ri][ci + 1];
      const topCellEval = makeSubCurveEval(hBounds[ri].eval, topU0, topU1, cellW);

      // Bottom boundary: sub-curve of hBounds[ri+1]
      const botU0 = crossU[ri + 1][ci], botU1 = crossU[ri + 1][ci + 1];
      const botCellEval = makeSubCurveEval(hBounds[ri + 1].eval, botU0, botU1, cellW);

      // Left boundary: straight line from cP00 to cP01 (for align guides and edges)
      const leftCellEval = ci === 0
        ? makeEdgeSubEval(Lraw, crossV[0][ri], crossV[0][ri + 1])
        : makeStraightEval(cP00, cP01);

      // Right boundary: straight line from cP10 to cP11
      const rightCellEval = ci === numCols - 1
        ? makeEdgeSubEval(Rraw, crossV[vBounds.length - 1][ri], crossV[vBounds.length - 1][ri + 1])
        : makeStraightEval(cP10, cP11);

      // Precompute top/bottom rows
      const topPts = new Float64Array(cellW * 2);
      const botPts = new Float64Array(cellW * 2);
      for (let px = 0; px < cellW; px++) {
        const u = cellW > 1 ? px / (cellW - 1) : 0.5;
        const tp = topCellEval(u), bp = botCellEval(u);
        topPts[px * 2] = tp[0]; topPts[px * 2 + 1] = tp[1];
        botPts[px * 2] = bp[0]; botPts[px * 2 + 1] = bp[1];
      }

      for (let py = 0; py < cellH; py++) {
        const v = cellH > 1 ? py / (cellH - 1) : 0.5;
        const lv = leftCellEval(v), rv = rightCellEval(v);
        const omv = 1 - v;

        for (let px = 0; px < cellW; px++) {
          const u = cellW > 1 ? px / (cellW - 1) : 0.5;
          const omu = 1 - u;
          const tu0 = topPts[px * 2], tu1 = topPts[px * 2 + 1];
          const bu0 = botPts[px * 2], bu1 = botPts[px * 2 + 1];

          const mx = omv * tu0 + v * bu0 + omu * lv[0] + u * rv[0]
            - omu * omv * cP00[0] - u * omv * cP10[0] - omu * v * cP01[0] - u * v * cP11[0];
          const my = omv * tu1 + v * bu1 + omu * lv[1] + u * rv[1]
            - omu * omv * cP00[1] - u * omv * cP10[1] - omu * v * cP01[1] - u * v * cP11[1];

          const srcX = mx * sX, srcY = my * sY;
          if (srcX < 0 || srcX >= imgW - 1 || srcY < 0 || srcY >= imgH - 1) continue;

          const ix = Math.floor(srcX), iy = Math.floor(srcY);
          const fx = srcX - ix, fy = srcY - iy;
          const outIdx = ((yOff + py) * outW + (xOff + px)) * 4;
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

      xOff += cellW;
    }
    yOff += cellH;
  }

  outCtx.putImageData(outData, 0, 0);
  return outCanvas;
}

/** Create evaluator for a sub-range of an existing evaluator, with arc-length reparameterization. */
function makeSubCurveEval(
  parentEval: (u: number) => Pt, u0: number, u1: number, samples: number,
): (u: number) => Pt {
  if (Math.abs(u1 - u0) < 1e-10) return () => parentEval(u0);
  // Build arc-length table for the sub-range
  const N = Math.min(samples, 200);
  const pts: Pt[] = [];
  for (let i = 0; i <= N; i++) {
    pts.push(parentEval(u0 + (i / N) * (u1 - u0)));
  }
  const cumLen = new Float64Array(N + 1);
  for (let i = 1; i <= N; i++) {
    cumLen[i] = cumLen[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  }
  const total = cumLen[N];
  if (total < 1e-10) return () => pts[0];
  return (u: number) => {
    const target = u * total;
    let lo = 0, hi = N;
    while (lo < hi - 1) {
      const mid = (lo + hi) >> 1;
      if (cumLen[mid] < target) lo = mid; else hi = mid;
    }
    const seg = cumLen[hi] - cumLen[lo];
    const frac = seg > 1e-10 ? (target - cumLen[lo]) / seg : 0;
    const t = (lo + frac) / N;
    return parentEval(u0 + t * (u1 - u0));
  };
}

/** Straight line evaluator (linear interpolation). */
function makeStraightEval(p0: Pt, p1: Pt): (v: number) => Pt {
  return (v: number): Pt => [p0[0] + v * (p1[0] - p0[0]), p0[1] + v * (p1[1] - p0[1])];
}

/** Arc-length parameterized sub-curve of a Bezier edge. */
function makeEdgeSubEval(edge: BezierPts, v0: number, v1: number): (v: number) => Pt {
  const sub = subBezier(edge[0], edge[1], edge[2], edge[3], v0, v1);
  return makeArcLengthEval(sub[0], sub[1], sub[2], sub[3]);
}

// ─── Coons patch crop ───────────────────────────────────────────────────────

export function perspectiveCrop(
  originalCanvas: HTMLCanvasElement,
  quadResult: QuadResult,
  maskWidth: number,
  maskHeight: number,
  maxSize?: number,
): HTMLCanvasElement | null {
  const { corners, edgeFits } = quadResult;
  const imgW = originalCanvas.width,
    imgH = originalCanvas.height;
  const sX = imgW / maskWidth,
    sY = imgH / maskHeight;

  // Corners: [0]=TL, [1]=TR, [2]=BR, [3]=BL (clockwise from sortCorners)
  const P00 = corners[0],
    P10 = corners[1],
    P11 = corners[2],
    P01 = corners[3];

  // Edge curves with arc-length parameterization
  // T(u): TL→TR, R(v): TR→BR, B(u): BL→BR (reversed), L(v): TL→BL (reversed)
  const T = makeArcLengthEval(P00, edgeFits[0].cp1, edgeFits[0].cp2, P10);
  const R = makeArcLengthEval(P10, edgeFits[1].cp1, edgeFits[1].cp2, P11);
  const B = makeArcLengthEval(
    P01,
    edgeFits[2].cp2,
    edgeFits[2].cp1,
    P11,
  ); // reversed
  const L = makeArcLengthEval(
    P00,
    edgeFits[3].cp2,
    edgeFits[3].cp1,
    P01,
  ); // reversed

  // Output dimensions from vanishing-point aspect-ratio recovery
  const imgCorners: [number, number][] = corners.map((c) => [
    c[0] * sX,
    c[1] * sY,
  ]);
  const dims = computeCropDimensions(imgCorners, imgW, imgH);
  if (!dims) return null;
  let outW = dims.outW;
  let outH = dims.outH;

  // Optional size cap for preview during drag
  if (maxSize && (outW > maxSize || outH > maxSize)) {
    const scale = maxSize / Math.max(outW, outH);
    outW = Math.round(outW * scale);
    outH = Math.round(outH * scale);
  }

  if (outW < 2 || outH < 2) return null;

  // Pre-compute top and bottom boundary curves for all u values
  const topPts = new Float64Array(outW * 2);
  const botPts = new Float64Array(outW * 2);
  for (let px = 0; px < outW; px++) {
    const u = px / (outW - 1);
    const t = T(u),
      b = B(u);
    topPts[px * 2] = t[0];
    topPts[px * 2 + 1] = t[1];
    botPts[px * 2] = b[0];
    botPts[px * 2 + 1] = b[1];
  }

  // Coons patch: S(u,v) = (1-v)*T(u) + v*B(u) + (1-u)*L(v) + u*R(v)
  //                       - (1-u)(1-v)*P00 - u(1-v)*P10 - (1-u)v*P01 - uv*P11
  const srcData = originalCanvas
    .getContext("2d")!
    .getImageData(0, 0, imgW, imgH);
  const outCanvas = document.createElement("canvas");
  outCanvas.width = outW;
  outCanvas.height = outH;
  const outCtx = outCanvas.getContext("2d")!;
  const outData = outCtx.createImageData(outW, outH);

  for (let py = 0; py < outH; py++) {
    const v = py / (outH - 1);
    const lv = L(v),
      rv = R(v);
    const omv = 1 - v;

    for (let px = 0; px < outW; px++) {
      const u = px / (outW - 1);
      const omu = 1 - u;
      const tu0 = topPts[px * 2],
        tu1 = topPts[px * 2 + 1];
      const bu0 = botPts[px * 2],
        bu1 = botPts[px * 2 + 1];

      // Coons patch → source coordinate in mask space
      const mx =
        omv * tu0 +
        v * bu0 +
        omu * lv[0] +
        u * rv[0] -
        omu * omv * P00[0] -
        u * omv * P10[0] -
        omu * v * P01[0] -
        u * v * P11[0];
      const my =
        omv * tu1 +
        v * bu1 +
        omu * lv[1] +
        u * rv[1] -
        omu * omv * P00[1] -
        u * omv * P10[1] -
        omu * v * P01[1] -
        u * v * P11[1];

      // Scale to image space
      const srcX = mx * sX,
        srcY = my * sY;
      if (srcX < 0 || srcX >= imgW - 1 || srcY < 0 || srcY >= imgH - 1)
        continue;

      // Bilinear interpolation
      const ix = Math.floor(srcX),
        iy = Math.floor(srcY);
      const fx = srcX - ix,
        fy = srcY - iy;
      const outIdx = (py * outW + px) * 4;
      for (let c = 0; c < 3; c++) {
        const v00 = srcData.data[(iy * imgW + ix) * 4 + c];
        const v10 = srcData.data[(iy * imgW + ix + 1) * 4 + c];
        const v01 = srcData.data[((iy + 1) * imgW + ix) * 4 + c];
        const v11 = srcData.data[((iy + 1) * imgW + ix + 1) * 4 + c];
        outData.data[outIdx + c] = Math.round(
          v00 * (1 - fx) * (1 - fy) +
            v10 * fx * (1 - fy) +
            v01 * (1 - fx) * fy +
            v11 * fx * fy,
        );
      }
      outData.data[outIdx + 3] = 255;
    }
  }

  outCtx.putImageData(outData, 0, 0);
  return outCanvas;
}

// ─── Output dimension estimation via vanishing-point aspect-ratio recovery ──
//
// Given a perspective-distorted rectangle in an image, recover the true W:H
// ratio from the homography that maps a unit square to the quad.
//
// Derivation (assuming square pixels, principal point at image centre):
//   H = [h1 | h2 | h3] maps unit square → image quad
//   Camera model: h1 ∝ K·r1·W, h2 ∝ K·r2·H  (r1,r2 orthonormal)
//   Orthogonality r1ᵀr2 = 0  →  h1ᵀ ω h2 = 0  where ω = (KᵀK)⁻¹ = diag(1/f²,1/f²,1)
//   Equal norms  ||r1||=||r2||  →  W/H = √(h1ᵀ ω h1 / h2ᵀ ω h2)
//   Solve for f² from orthogonality, then compute ratio.
//   Total pixel count comes from the quad's shoelace area.

function computeCropDimensions(
  imgCorners: [number, number][],
  imgW: number,
  imgH: number,
): { outW: number; outH: number } | null {
  // Centre coordinates at principal point
  const cx = imgW / 2,
    cy = imgH / 2;
  const centred: [number, number][] = imgCorners.map(([x, y]) => [
    x - cx,
    y - cy,
  ]);

  // Homography: unit square [TL,TR,BR,BL] → centred quad
  const unitSq: [number, number][] = [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 1],
  ];
  const H = computeHomography(unitSq, centred);

  // Column vectors of H
  const h1 = [H[0], H[3], H[6]]; // x-basis (width direction)
  const h2 = [H[1], H[4], H[7]]; // y-basis (height direction)

  // Affine ratio: √(||h1_xy||² / ||h2_xy||²) — the aspect ratio implied
  // by the affine (non-projective) part of the homography.  This is always
  // well-defined, accounts for rotation/shear, and doesn't depend on
  // focal-length estimation.  It equals the true ratio when perspective is
  // negligible and is a reasonable approximation otherwise.
  const affNorm1 = h1[0] * h1[0] + h1[1] * h1[1];
  const affNorm2 = h2[0] * h2[0] + h2[1] * h2[1];
  const affineRatio = affNorm2 > 0 ? Math.sqrt(affNorm1 / affNorm2) : null;

  let ratio: number | null = null; // W / H
  const denom = h1[2] * h2[2];
  if (Math.abs(denom) > 1e-10) {
    const fSq = -(h1[0] * h2[0] + h1[1] * h2[1]) / denom;
    // Accept f² only when positive and plausible (f < 10× image diagonal).
    // Beyond that the perspective signal is too weak for reliable estimation.
    const maxDim = Math.max(imgW, imgH);
    if (fSq > 0 && fSq < maxDim * maxDim * 100) {
      const norm1Sq = affNorm1 / fSq + h1[2] * h1[2];
      const norm2Sq = affNorm2 / fSq + h2[2] * h2[2];
      if (norm2Sq > 0) ratio = Math.sqrt(norm1Sq / norm2Sq);
    }
  }

  // Fallback chain: affine ratio > edge-length ratio
  if (ratio === null || !isFinite(ratio) || ratio <= 0) {
    if (affineRatio !== null && isFinite(affineRatio) && affineRatio > 0) {
      ratio = affineRatio;
    } else {
      const d = (a: [number, number], b: [number, number]) =>
        Math.hypot(b[0] - a[0], b[1] - a[1]);
      const avgW =
        (d(imgCorners[0], imgCorners[1]) + d(imgCorners[3], imgCorners[2])) / 2;
      const avgH =
        (d(imgCorners[0], imgCorners[3]) + d(imgCorners[1], imgCorners[2])) / 2;
      ratio = avgW / avgH;
    }
  }

  // Quad area via shoelace formula
  let area = 0;
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    area +=
      imgCorners[i][0] * imgCorners[j][1] -
      imgCorners[j][0] * imgCorners[i][1];
  }
  area = Math.abs(area) / 2;

  const outW = Math.round(Math.sqrt(area * ratio));
  const outH = Math.round(Math.sqrt(area / ratio));
  return outW >= 2 && outH >= 2 ? { outW, outH } : null;
}

// ─── Homography crop ────────────────────────────────────────────────────────

function solveLinear(A: number[][], b: number[]): number[] {
  const n = A.length;
  const aug = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let maxVal = Math.abs(aug[col][col]),
      maxRow = col;
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(aug[row][col]) > maxVal) {
        maxVal = Math.abs(aug[row][col]);
        maxRow = row;
      }
    }
    [aug[col], aug[maxRow]] = [aug[maxRow], aug[col]];
    for (let row = col + 1; row < n; row++) {
      const f = aug[row][col] / aug[col][col];
      for (let j = col; j <= n; j++) aug[row][j] -= f * aug[col][j];
    }
  }
  const x = new Array(n);
  for (let i = n - 1; i >= 0; i--) {
    x[i] = aug[i][n];
    for (let j = i + 1; j < n; j++) x[i] -= aug[i][j] * x[j];
    x[i] /= aug[i][i];
  }
  return x;
}

function computeHomography(
  src: [number, number][],
  dst: [number, number][],
): number[] {
  const A: number[][] = [],
    b: number[] = [];
  for (let i = 0; i < 4; i++) {
    const [sx, sy] = src[i],
      [dx, dy] = dst[i];
    A.push([sx, sy, 1, 0, 0, 0, -sx * dx, -sy * dx]);
    b.push(dx);
    A.push([0, 0, 0, sx, sy, 1, -sx * dy, -sy * dy]);
    b.push(dy);
  }
  const h = solveLinear(A, b);
  return [...h, 1];
}

export function perspectiveHomography(
  originalCanvas: HTMLCanvasElement,
  quadResult: QuadResult,
  maskWidth: number,
  maskHeight: number,
): HTMLCanvasElement | null {
  const { corners } = quadResult;
  const imgW = originalCanvas.width,
    imgH = originalCanvas.height;
  const sX = imgW / maskWidth,
    sY = imgH / maskHeight;

  const imgCorners: [number, number][] = corners.map((c) => [
    c[0] * sX,
    c[1] * sY,
  ]);

  const dims = computeCropDimensions(imgCorners, imgW, imgH);
  if (!dims) return null;
  const { outW, outH } = dims;

  const dstCorners: [number, number][] = [
    [0, 0],
    [outW, 0],
    [outW, outH],
    [0, outH],
  ];
  const H = computeHomography(dstCorners, imgCorners);

  const srcData = originalCanvas
    .getContext("2d")!
    .getImageData(0, 0, imgW, imgH);
  const outCanvas = document.createElement("canvas");
  outCanvas.width = outW;
  outCanvas.height = outH;
  const outCtx = outCanvas.getContext("2d")!;
  const outData = outCtx.createImageData(outW, outH);

  for (let py = 0; py < outH; py++) {
    for (let px = 0; px < outW; px++) {
      const w = H[6] * px + H[7] * py + H[8];
      if (Math.abs(w) < 1e-10) continue;
      const srcX = (H[0] * px + H[1] * py + H[2]) / w;
      const srcY = (H[3] * px + H[4] * py + H[5]) / w;
      if (srcX < 0 || srcX >= imgW - 1 || srcY < 0 || srcY >= imgH - 1)
        continue;

      const ix = Math.floor(srcX),
        iy = Math.floor(srcY);
      const fx = srcX - ix,
        fy = srcY - iy;
      const outIdx = (py * outW + px) * 4;
      for (let c = 0; c < 3; c++) {
        const v00 = srcData.data[(iy * imgW + ix) * 4 + c];
        const v10 = srcData.data[(iy * imgW + ix + 1) * 4 + c];
        const v01 = srcData.data[((iy + 1) * imgW + ix) * 4 + c];
        const v11 = srcData.data[((iy + 1) * imgW + ix + 1) * 4 + c];
        outData.data[outIdx + c] = Math.round(
          v00 * (1 - fx) * (1 - fy) +
            v10 * fx * (1 - fy) +
            v01 * (1 - fx) * fy +
            v11 * fx * fy,
        );
      }
      outData.data[outIdx + 3] = 255;
    }
  }

  outCtx.putImageData(outData, 0, 0);
  return outCanvas;
}

// ─── Canvas rotation ────────────────────────────────────────────────────────

export function rotateCanvas(
  canvas: HTMLCanvasElement,
  rotation: 0 | 90 | 180 | 270,
): HTMLCanvasElement {
  if (rotation === 0) return canvas;

  const out = document.createElement("canvas");
  const swap = rotation === 90 || rotation === 270;
  out.width = swap ? canvas.height : canvas.width;
  out.height = swap ? canvas.width : canvas.height;

  const ctx = out.getContext("2d")!;
  ctx.translate(out.width / 2, out.height / 2);
  ctx.rotate((rotation * Math.PI) / 180);
  ctx.drawImage(canvas, -canvas.width / 2, -canvas.height / 2);

  return out;
}
