/**
 * Binarization Web Worker
 *
 * Pipeline: ImageBitmap -> upscale (OffscreenCanvas) -> grayscale -> integral image -> adaptive threshold -> output
 *
 * Algorithm reference: from-external-repo/HANDOFF.md get_binarized_image
 */

interface BinarizeRequest {
  id: number;
  bitmap: ImageBitmap;
  blockRadiusBps: number;
  contrastOffset: number;
  upsamplingScale: number;
}

function binarize(
  bitmap: ImageBitmap,
  blockRadiusBps: number,
  contrastOffset: number,
  upsamplingScale: number,
): { data: ArrayBuffer; width: number; height: number } {
  const origW = bitmap.width;
  const origH = bitmap.height;
  const scale = upsamplingScale / 100;
  const upW = Math.max(1, Math.round(origW * scale));
  const upH = Math.max(1, Math.round(origH * scale));

  // Upscale via OffscreenCanvas (hardware-accelerated bilinear interpolation)
  const canvas = new OffscreenCanvas(upW, upH);
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(bitmap, 0, 0, upW, upH);
  bitmap.close();

  const imgData = ctx.getImageData(0, 0, upW, upH);
  const pixels = imgData.data;

  // Grayscale conversion (ITU-R BT.601 luma)
  const gray = new Uint8Array(upW * upH);
  for (let i = 0; i < gray.length; i++) {
    const off = i * 4;
    gray[i] = Math.round(
      0.299 * pixels[off] + 0.587 * pixels[off + 1] + 0.114 * pixels[off + 2],
    );
  }

  // Block radius: sqrt(W * H * bps / 10000)
  const blockRadius = Math.max(
    1,
    Math.round(Math.sqrt((upW * upH * blockRadiusBps) / 10000)),
  );

  // Integral image (Float64 to avoid precision loss on large images)
  const integral = new Float64Array(upW * upH);
  for (let y = 0; y < upH; y++) {
    let rowSum = 0;
    for (let x = 0; x < upW; x++) {
      const idx = y * upW + x;
      rowSum += gray[idx];
      integral[idx] = rowSum + (y > 0 ? integral[idx - upW] : 0);
    }
  }

  // Adaptive threshold using integral image for O(1) per-pixel local mean
  const result = new Uint8ClampedArray(upW * upH * 4);
  for (let y = 0; y < upH; y++) {
    for (let x = 0; x < upW; x++) {
      const x1 = Math.max(0, x - blockRadius);
      const y1 = Math.max(0, y - blockRadius);
      const x2 = Math.min(upW - 1, x + blockRadius);
      const y2 = Math.min(upH - 1, y + blockRadius);

      const count = (x2 - x1 + 1) * (y2 - y1 + 1);
      let sum = integral[y2 * upW + x2];
      if (x1 > 0) sum -= integral[y2 * upW + (x1 - 1)];
      if (y1 > 0) sum -= integral[(y1 - 1) * upW + x2];
      if (x1 > 0 && y1 > 0) sum += integral[(y1 - 1) * upW + (x1 - 1)];

      const localMean = sum / count;
      const threshold = Math.max(0, Math.min(255, localMean + contrastOffset));
      const val = gray[y * upW + x] >= threshold ? 255 : 0;

      const outIdx = (y * upW + x) * 4;
      result[outIdx] = val;
      result[outIdx + 1] = val;
      result[outIdx + 2] = val;
      result[outIdx + 3] = 255;
    }
  }

  return { data: result.buffer, width: upW, height: upH };
}

self.onmessage = (e: MessageEvent<BinarizeRequest>) => {
  const { id, bitmap, blockRadiusBps, contrastOffset, upsamplingScale } =
    e.data;
  try {
    const result = binarize(
      bitmap,
      blockRadiusBps,
      contrastOffset,
      upsamplingScale,
    );
    (self as unknown as Worker).postMessage(
      { ok: true, id, ...result },
      [result.data],
    );
  } catch (err) {
    (self as unknown as Worker).postMessage({
      ok: false,
      id,
      error: err instanceof Error ? err.message : String(err),
    });
  }
};
