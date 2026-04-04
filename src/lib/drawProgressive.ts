/**
 * Progressive downscale: halve the image in steps until close to target size,
 * then do a final drawImage to exact dimensions. Each bilinear 2x step
 * approximates area-average filtering, matching native Lanczos quality.
 */
export function drawProgressive(
  ctx: CanvasRenderingContext2D,
  source: HTMLCanvasElement | OffscreenCanvas,
  dstW: number,
  dstH: number,
): void {
  let current: HTMLCanvasElement | OffscreenCanvas = source;
  let curW = source.width;
  let curH = source.height;

  while (curW > dstW * 2 || curH > dstH * 2) {
    const halfW = Math.max(Math.round(curW / 2), dstW);
    const halfH = Math.max(Math.round(curH / 2), dstH);
    const tmp = new OffscreenCanvas(halfW, halfH);
    const tCtx = tmp.getContext("2d")!;
    tCtx.imageSmoothingEnabled = true;
    tCtx.imageSmoothingQuality = "high";
    tCtx.drawImage(current, 0, 0, halfW, halfH);
    current = tmp;
    curW = halfW;
    curH = halfH;
  }

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(current, 0, 0, dstW, dstH);
}
