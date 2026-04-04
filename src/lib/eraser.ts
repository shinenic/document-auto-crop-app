import type { EraseMask } from "./types";

/**
 * Apply an erase mask to a filtered canvas, returning a new canvas
 * with erased pixels set to white.
 */
export function applyEraseMask(
  filteredCanvas: HTMLCanvasElement,
  eraseMask: EraseMask,
): HTMLCanvasElement {
  const out = document.createElement("canvas");
  out.width = filteredCanvas.width;
  out.height = filteredCanvas.height;
  const ctx = out.getContext("2d")!;
  ctx.drawImage(filteredCanvas, 0, 0);

  const imageData = ctx.getImageData(0, 0, out.width, out.height);
  const pixels = imageData.data;
  const mask = eraseMask.data;

  const len = Math.min(mask.length, out.width * out.height);
  for (let i = 0; i < len; i++) {
    if (mask[i] === 255) {
      const j = i * 4;
      pixels[j] = 255;
      pixels[j + 1] = 255;
      pixels[j + 2] = 255;
      pixels[j + 3] = 255;
    }
  }

  ctx.putImageData(imageData, 0, 0);
  return out;
}

/**
 * Paint a circular brush stroke onto an erase mask.
 * Points is an array of [x, y] positions in mask coordinates.
 * Mutates the mask data in place.
 */
export function paintBrushStroke(
  mask: EraseMask,
  points: [number, number][],
  radius: number,
): void {
  const { width, height, data } = mask;
  const r2 = radius * radius;

  for (const [cx, cy] of points) {
    const minX = Math.max(0, Math.floor(cx - radius));
    const maxX = Math.min(width - 1, Math.ceil(cx + radius));
    const minY = Math.max(0, Math.floor(cy - radius));
    const maxY = Math.min(height - 1, Math.ceil(cy + radius));

    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const dx = x - cx;
        const dy = y - cy;
        if (dx * dx + dy * dy <= r2) {
          data[y * width + x] = 255;
        }
      }
    }
  }
}

/**
 * Fill a lasso region on the erase mask.
 * Uses an offscreen canvas to rasterize the polygon path, then copies
 * filled pixels onto the mask.
 */
export function fillLassoRegion(
  mask: EraseMask,
  points: [number, number][],
): void {
  if (points.length < 3) return;

  const { width, height, data } = mask;

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of points) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  minX = Math.max(0, Math.floor(minX));
  minY = Math.max(0, Math.floor(minY));
  maxX = Math.min(width - 1, Math.ceil(maxX));
  maxY = Math.min(height - 1, Math.ceil(maxY));

  const bw = maxX - minX + 1;
  const bh = maxY - minY + 1;
  if (bw <= 0 || bh <= 0) return;

  const oc = new OffscreenCanvas(bw, bh);
  const ctx = oc.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.beginPath();
  ctx.moveTo(points[0][0] - minX, points[0][1] - minY);
  for (let i = 1; i < points.length; i++) {
    ctx.lineTo(points[i][0] - minX, points[i][1] - minY);
  }
  ctx.closePath();
  ctx.fill();

  const id = ctx.getImageData(0, 0, bw, bh);
  const px = id.data;
  for (let ly = 0; ly < bh; ly++) {
    for (let lx = 0; lx < bw; lx++) {
      if (px[(ly * bw + lx) * 4 + 3] > 0) {
        data[(minY + ly) * width + (minX + lx)] = 255;
      }
    }
  }
}

/**
 * Create a blank erase mask matching the given dimensions.
 */
export function createEraseMask(width: number, height: number): EraseMask {
  return { width, height, data: new Uint8Array(width * height) };
}

/**
 * Clone an erase mask (deep copy of Uint8Array).
 */
export function cloneEraseMask(mask: EraseMask): EraseMask {
  return { width: mask.width, height: mask.height, data: new Uint8Array(mask.data) };
}
