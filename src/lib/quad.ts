/**
 * Quad detection pipeline — faithful port from demo/src/lib/segmentation.js
 *
 * Pipeline: morphOpen → traceContour → convexHull → findQuadCorners →
 *           PCA fitLine → intersectLines → edge extraction → edge classification →
 *           bezier fitting → QuadResult
 */
import type { EdgeFit, QuadResult } from "./types";

// ─── Morphological opening ──────────────────────────────────────────────────

function morphOpen(
  mask: Uint8Array,
  w: number,
  h: number,
  radius: number,
): Uint8Array {
  const offsets: number[] = [];
  const r2 = radius * radius;
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (dx * dx + dy * dy <= r2) offsets.push(dy * w + dx);
    }
  }
  const n = w * h;

  // Erode: pixel survives only if all kernel neighbors are set
  const eroded = new Uint8Array(n);
  for (let y = radius; y < h - radius; y++) {
    for (let x = radius; x < w - radius; x++) {
      const idx = y * w + x;
      if (mask[idx] === 0) continue;
      let allSet = true;
      for (let k = 0; k < offsets.length; k++) {
        if (mask[idx + offsets[k]] === 0) {
          allSet = false;
          break;
        }
      }
      if (allSet) eroded[idx] = 255;
    }
  }

  // Dilate: pixel is set if any kernel neighbor is set
  const opened = new Uint8Array(n);
  for (let y = radius; y < h - radius; y++) {
    for (let x = radius; x < w - radius; x++) {
      const idx = y * w + x;
      if (eroded[idx] === 0) continue;
      for (let k = 0; k < offsets.length; k++) {
        opened[idx + offsets[k]] = 255;
      }
    }
  }
  return opened;
}

// ─── Contour tracing (Moore neighborhood) ───────────────────────────────────

const DX = [1, 1, 0, -1, -1, -1, 0, 1];
const DY = [0, 1, 1, 1, 0, -1, -1, -1];

function traceContourFrom(
  mask: Uint8Array,
  w: number,
  h: number,
  startX: number,
  startY: number,
): [number, number][] {
  const contour: [number, number][] = [];
  let cx = startX,
    cy = startY;
  let backDir = 6;
  const maxIter = w * h * 2;

  for (let iter = 0; iter < maxIter; iter++) {
    contour.push([cx, cy]);
    let found = false;
    for (let i = 0; i < 8; i++) {
      const d = (backDir + 1 + i) % 8;
      const nx = cx + DX[d],
        ny = cy + DY[d];
      if (nx >= 0 && nx < w && ny >= 0 && ny < h && mask[ny * w + nx] > 0) {
        backDir = (d + 4) % 8;
        cx = nx;
        cy = ny;
        found = true;
        break;
      }
    }
    if (!found || (cx === startX && cy === startY)) break;
  }
  return contour;
}

function traceContour(
  mask: Uint8Array,
  w: number,
  h: number,
): [number, number][] {
  // Try 1: start from first non-zero pixel (top-left scan)
  let startX = -1,
    startY = -1;
  for (let y = 0; y < h && startX === -1; y++) {
    for (let x = 0; x < w; x++) {
      if (mask[y * w + x] > 0) {
        startX = x;
        startY = y;
        break;
      }
    }
  }
  if (startX === -1) return [];

  const contour = traceContourFrom(mask, w, h, startX, startY);

  // Quality check: bounding box should cover >5% of image
  if (contour.length > 0) {
    let minX = Infinity,
      maxX = -Infinity,
      minY = Infinity,
      maxY = -Infinity;
    for (const [x, y] of contour) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    const bboxArea = (maxX - minX) * (maxY - minY);
    if (bboxArea >= w * h * 0.05) return contour;
  }

  // Try 2: start from topmost pixel in the center-of-mass column
  let sumX = 0,
    count = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (mask[y * w + x] > 0) {
        sumX += x;
        count++;
      }
    }
  }
  if (count === 0) return contour;
  const cmx = Math.round(sumX / count);
  for (let y = 0; y < h; y++) {
    if (mask[y * w + cmx] > 0) {
      return traceContourFrom(mask, w, h, cmx, y);
    }
  }

  return contour;
}

// ─── Convex hull (Andrew's monotone chain) ──────────────────────────────────

function convexHull(points: [number, number][]): [number, number][] {
  const sorted = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const n = sorted.length;
  if (n <= 2) return sorted.slice();
  const hull: [number, number][] = [];
  for (const p of sorted) {
    while (hull.length >= 2) {
      const a = hull[hull.length - 2],
        b = hull[hull.length - 1];
      if (
        (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]) <=
        0
      )
        hull.pop();
      else break;
    }
    hull.push(p);
  }
  const lower = hull.length + 1;
  for (let i = n - 2; i >= 0; i--) {
    const p = sorted[i];
    while (hull.length >= lower) {
      const a = hull[hull.length - 2],
        b = hull[hull.length - 1];
      if (
        (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]) <=
        0
      )
        hull.pop();
      else break;
    }
    hull.push(p);
  }
  hull.pop();
  return hull;
}

// ─── Corner detection ───────────────────────────────────────────────────────

function findQuadCorners(
  hull: [number, number][],
): [number, number, number, number] | null {
  const n = hull.length;
  let maxDist = -1,
    d1 = 0,
    d2 = 0;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const d = Math.hypot(
        hull[i][0] - hull[j][0],
        hull[i][1] - hull[j][1],
      );
      if (d > maxDist) {
        maxDist = d;
        d1 = i;
        d2 = j;
      }
    }
  }
  const [ax, ay] = hull[d1],
    [bx, by] = hull[d2];
  let maxPos = -Infinity,
    maxNeg = Infinity,
    p3 = -1,
    p4 = -1;
  for (let i = 0; i < n; i++) {
    if (i === d1 || i === d2) continue;
    const cross =
      (bx - ax) * (hull[i][1] - ay) - (by - ay) * (hull[i][0] - ax);
    if (cross > maxPos) {
      maxPos = cross;
      p3 = i;
    }
    if (cross < maxNeg) {
      maxNeg = cross;
      p4 = i;
    }
  }
  if (p3 === -1 || p4 === -1) return null;
  return [d1, d2, p3, p4];
}

// ─── PCA line fitting ───────────────────────────────────────────────────────

interface FittedLine {
  cx: number;
  cy: number;
  dx: number;
  dy: number;
}

function fitLine(
  contour: [number, number][],
  indices: number[],
): FittedLine {
  let cx = 0,
    cy = 0;
  for (const i of indices) {
    cx += contour[i][0];
    cy += contour[i][1];
  }
  cx /= indices.length;
  cy /= indices.length;

  let xx = 0,
    xy = 0,
    yy = 0;
  for (const i of indices) {
    const dx = contour[i][0] - cx,
      dy = contour[i][1] - cy;
    xx += dx * dx;
    xy += dx * dy;
    yy += dy * dy;
  }
  const theta = 0.5 * Math.atan2(2 * xy, xx - yy);
  return { cx, cy, dx: Math.cos(theta), dy: Math.sin(theta) };
}

function intersectLines(
  l1: FittedLine,
  l2: FittedLine,
): [number, number] | null {
  const x1 = l1.cx,
    y1 = l1.cy,
    x2 = l1.cx + l1.dx,
    y2 = l1.cy + l1.dy;
  const x3 = l2.cx,
    y3 = l2.cy,
    x4 = l2.cx + l2.dx,
    y4 = l2.cy + l2.dy;
  const denom = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
  if (Math.abs(denom) < 1e-10) return null;
  const t1 = x1 * y2 - y1 * x2,
    t2 = x3 * y4 - y3 * x4;
  return [
    (t1 * (x3 - x4) - (x1 - x2) * t2) / denom,
    (t1 * (y3 - y4) - (y1 - y2) * t2) / denom,
  ];
}

// ─── Corner sorting ─────────────────────────────────────────────────────────

function sortCorners(corners: [number, number][]): [number, number][] {
  let cx = 0,
    cy = 0;
  for (const c of corners) {
    cx += c[0];
    cy += c[1];
  }
  cx /= corners.length;
  cy /= corners.length;
  corners.sort(
    (a, b) =>
      Math.atan2(a[1] - cy, a[0] - cx) - Math.atan2(b[1] - cy, b[0] - cx),
  );
  return corners;
}

// ─── Edge helpers ───────────────────────────────────────────────────────────

function nearestContourIndex(
  contour: [number, number][],
  point: [number, number] | number[],
): number {
  let bestDist = Infinity,
    bestIdx = 0;
  for (let i = 0; i < contour.length; i++) {
    const dx = contour[i][0] - point[0],
      dy = contour[i][1] - point[1];
    const d = dx * dx + dy * dy;
    if (d < bestDist) {
      bestDist = d;
      bestIdx = i;
    }
  }
  return bestIdx;
}

function extractSubContour(
  contour: [number, number][],
  fromIdx: number,
  toIdx: number,
): [number, number][] {
  const n = contour.length;
  const sub: [number, number][] = [];
  let i = fromIdx;
  while (i !== toIdx) {
    sub.push(contour[i]);
    i = (i + 1) % n;
  }
  sub.push(contour[toIdx]);
  return sub;
}

function maxDeviation(points: [number, number][]): number {
  if (points.length < 3) return 0;
  const [ax, ay] = points[0];
  const [bx, by] = points[points.length - 1];
  const lenSq = (bx - ax) ** 2 + (by - ay) ** 2;
  if (lenSq < 1e-10) return 0;
  let maxD = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const [px, py] = points[i];
    const d =
      Math.abs((by - ay) * px - (bx - ax) * py + bx * ay - by * ax) /
      Math.sqrt(lenSq);
    if (d > maxD) maxD = d;
  }
  return maxD;
}

// ─── Angle helpers ──────────────────────────────────────────────────────────

function angleDiff(a: number, b: number): number {
  let d = Math.abs(a - b) % (2 * Math.PI);
  return d > Math.PI ? 2 * Math.PI - d : d;
}

// ─── Bezier fitting ─────────────────────────────────────────────────────────

function filterSharpPoints(
  points: [number, number][],
  maxAngle: number,
): [number, number][] {
  if (points.length <= 2) return points;
  const result: [number, number][] = [points[0]];
  for (let i = 1; i < points.length - 1; i++) {
    const prev = result[result.length - 1];
    const curr = points[i];
    const next = points[i + 1];
    const a1 = Math.atan2(curr[1] - prev[1], curr[0] - prev[0]);
    const a2 = Math.atan2(next[1] - curr[1], next[0] - curr[0]);
    if (angleDiff(a1, a2) < maxAngle) {
      result.push(curr);
    }
  }
  result.push(points[points.length - 1]);
  return result;
}

function fitCubicBezier(
  points: [number, number][],
): { cp1: [number, number]; cp2: [number, number] } {
  const p0 = points[0];
  const p3 = points[points.length - 1];

  // Parameterize by cumulative chord length (0..1)
  const dists = [0];
  for (let i = 1; i < points.length; i++) {
    dists.push(
      dists[i - 1] +
        Math.hypot(
          points[i][0] - points[i - 1][0],
          points[i][1] - points[i - 1][1],
        ),
    );
  }
  const totalLen = dists[dists.length - 1];
  if (totalLen < 1e-10) return { cp1: p0 as [number, number], cp2: p3 as [number, number] };
  const t = dists.map((d) => d / totalLen);

  // Least-squares for P1, P2 control points
  let aa = 0,
    ab = 0,
    bb = 0;
  let arx = 0,
    ary = 0,
    brx = 0,
    bry = 0;

  for (let i = 1; i < points.length - 1; i++) {
    const ti = t[i];
    const omt = 1 - ti;
    const a = 3 * omt * omt * ti;
    const b = 3 * omt * ti * ti;
    const rx =
      points[i][0] - omt * omt * omt * p0[0] - ti * ti * ti * p3[0];
    const ry =
      points[i][1] - omt * omt * omt * p0[1] - ti * ti * ti * p3[1];

    aa += a * a;
    ab += a * b;
    bb += b * b;
    arx += a * rx;
    ary += a * ry;
    brx += b * rx;
    bry += b * ry;
  }

  const det = aa * bb - ab * ab;
  if (Math.abs(det) < 1e-10) {
    return {
      cp1: [
        p0[0] + (p3[0] - p0[0]) / 3,
        p0[1] + (p3[1] - p0[1]) / 3,
      ],
      cp2: [
        p0[0] + (2 * (p3[0] - p0[0])) / 3,
        p0[1] + (2 * (p3[1] - p0[1])) / 3,
      ],
    };
  }

  return {
    cp1: [(bb * arx - ab * brx) / det, (bb * ary - ab * bry) / det],
    cp2: [(aa * brx - ab * arx) / det, (aa * bry - ab * ary) / det],
  };
}

// ─── Main quad detection ────────────────────────────────────────────────────

const CURVE_THRESH = 0.02;

export function findQuadrilateral(
  mask: Uint8Array,
  w: number,
  h: number,
): QuadResult | null {
  const contour = traceContour(mask, w, h);
  if (contour.length < 20) return null;

  // Clean mask: morphological opening removes thin protrusions
  const cleanMask = morphOpen(mask, w, h, 5);
  const cleanContour = traceContour(cleanMask, w, h);
  const geomContour = cleanContour.length >= 20 ? cleanContour : contour;

  // Step 1: Convex hull
  const hull = convexHull(geomContour);
  if (hull.length < 4) return null;

  // Step 2: Find 4 well-separated corners on hull
  const cornerResult = findQuadCorners(hull);
  if (!cornerResult) return null;

  // Step 3: Sort hull corner indices in hull order
  const hn = hull.length;
  const approxIdx = [...cornerResult].sort((a, b) => a - b);

  // Step 4: PCA fit on hull points between adjacent corners
  const lines: FittedLine[] = [];
  for (let i = 0; i < 4; i++) {
    const from = approxIdx[i],
      to = approxIdx[(i + 1) % 4];
    const len = ((to - from) % hn + hn) % hn;
    const indices: number[] = [];
    for (let s = 0; s <= len; s++) indices.push((from + s) % hn);
    // Trim 15% from ends for cleaner PCA
    const trim = Math.max(1, Math.floor(indices.length * 0.15));
    const trimmed =
      indices.length > trim * 2 + 2
        ? indices.slice(trim, -trim)
        : indices;
    lines.push(fitLine(hull, trimmed));
  }

  const corners: [number, number][] = [];
  for (let i = 0; i < 4; i++) {
    const pt = intersectLines(lines[i], lines[(i + 1) % 4]);
    if (!pt) return null;
    corners.push(pt);
  }
  sortCorners(corners);

  // Step 5: Map PCA corners to original contour
  const snappedCorners: [number, number][] = [];
  const cornerIndices: number[] = [];
  for (const c of corners) {
    const mx = Math.round(c[0]),
      my = Math.round(c[1]);
    const inside =
      mx >= 0 && mx < w && my >= 0 && my < h && mask[my * w + mx] > 0;
    if (inside) {
      snappedCorners.push([c[0], c[1]]);
      cornerIndices.push(nearestContourIndex(contour, c));
    } else {
      const idx = nearestContourIndex(contour, c);
      snappedCorners.push([...contour[idx]]);
      cornerIndices.push(idx);
    }
  }

  // Step 6: Extract edges from original contour (preserves actual curves)
  const edges: [number, number][][] = [];
  for (let i = 0; i < 4; i++) {
    edges.push(
      extractSubContour(
        contour,
        cornerIndices[i],
        cornerIndices[(i + 1) % 4],
      ),
    );
  }

  // Step 7: Edge classification with opposite-pair consistency
  const curveRatios = edges.map((edge, i) => {
    const start = snappedCorners[i],
      end = snappedCorners[(i + 1) % 4];
    const edgeLen = Math.hypot(end[0] - start[0], end[1] - start[1]);
    return edgeLen > 0 ? maxDeviation(edge) / edgeLen : 0;
  });

  function pairDecision(ratioA: number, ratioB: number): boolean {
    return ratioA > CURVE_THRESH || ratioB > CURVE_THRESH;
  }
  const arc02 = pairDecision(curveRatios[0], curveRatios[2]);
  const arc13 = pairDecision(curveRatios[1], curveRatios[3]);
  const isArc = [arc02, arc13, arc02, arc13];

  // Step 8: Bezier fit per edge
  const edgeFits: EdgeFit[] = [];
  for (let i = 0; i < 4; i++) {
    const start = snappedCorners[i],
      end = snappedCorners[(i + 1) % 4];
    const edge = edges[i];
    if (isArc[i] && edge.length >= 3) {
      const filtered = filterSharpPoints(edge, Math.PI / 3);
      filtered[0] = start;
      filtered[filtered.length - 1] = end;
      const { cp1, cp2 } = fitCubicBezier(filtered);
      edgeFits.push({ cp1, cp2, isArc: true });
    } else {
      edgeFits.push({
        cp1: [
          start[0] + (end[0] - start[0]) / 3,
          start[1] + (end[1] - start[1]) / 3,
        ],
        cp2: [
          start[0] + (2 * (end[0] - start[0])) / 3,
          start[1] + (2 * (end[1] - start[1])) / 3,
        ],
        isArc: false,
      });
    }
  }

  return { corners: snappedCorners, edges, edgeFits };
}
