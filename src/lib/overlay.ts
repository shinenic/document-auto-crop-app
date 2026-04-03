/** Render original image with semi-transparent mask overlay. */
export function renderMaskOverlay(
  originalCanvas: HTMLCanvasElement,
  mask: Uint8Array,
  maskWidth: number,
  maskHeight: number,
): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = originalCanvas.width;
  canvas.height = originalCanvas.height;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(originalCanvas, 0, 0);

  const maskCanvas = document.createElement("canvas");
  maskCanvas.width = maskWidth;
  maskCanvas.height = maskHeight;
  const mCtx = maskCanvas.getContext("2d")!;
  const mData = mCtx.createImageData(maskWidth, maskHeight);
  for (let i = 0; i < mask.length; i++) {
    if (mask[i] > 0) {
      mData.data[i * 4] = 0;
      mData.data[i * 4 + 1] = 200;
      mData.data[i * 4 + 2] = 170;
      mData.data[i * 4 + 3] = 50;
    }
  }
  mCtx.putImageData(mData, 0, 0);
  ctx.drawImage(maskCanvas, 0, 0, canvas.width, canvas.height);

  return canvas;
}
