/**
 * Perspective crop — faithful port from demo/src/lib/segmentation.js
 *
 * perspectiveCrop: Coons patch with arc-length parameterized Bezier boundaries
 * perspectiveHomography: Standard 4-point homography (straight edges only)
 */
import type { QuadResult } from "./types";

// ─── Bezier evaluation ──────────────────────────────────────────────────────

function evalBezier(
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

function makeArcLengthEval(
  p0: [number, number],
  cp1: [number, number],
  cp2: [number, number],
  p3: [number, number],
): (u: number) => [number, number] {
  const table = buildArcLengthTable(p0, cp1, cp2, p3);
  return (u: number) =>
    evalBezier(p0, cp1, cp2, p3, arcLengthToT(table, u));
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

  let ratio: number | null = null; // W / H
  const denom = h1[2] * h2[2];
  if (Math.abs(denom) > 1e-10) {
    const fSq = -(h1[0] * h2[0] + h1[1] * h2[1]) / denom;
    if (fSq > 0) {
      const norm1Sq =
        (h1[0] * h1[0] + h1[1] * h1[1]) / fSq + h1[2] * h1[2];
      const norm2Sq =
        (h2[0] * h2[0] + h2[1] * h2[1]) / fSq + h2[2] * h2[2];
      if (norm2Sq > 0) ratio = Math.sqrt(norm1Sq / norm2Sq);
    }
  }

  // Fallback: average of opposite edge lengths
  if (ratio === null || !isFinite(ratio) || ratio <= 0) {
    const d = (a: [number, number], b: [number, number]) =>
      Math.hypot(b[0] - a[0], b[1] - a[1]);
    const avgW =
      (d(imgCorners[0], imgCorners[1]) + d(imgCorners[3], imgCorners[2])) / 2;
    const avgH =
      (d(imgCorners[0], imgCorners[3]) + d(imgCorners[1], imgCorners[2])) / 2;
    ratio = avgW / avgH;
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
