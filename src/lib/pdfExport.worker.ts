/**
 * PDF Export Web Worker
 *
 * Builds a multi-page PDF from an array of page descriptors.
 * Each page is either a JPEG (embedded directly) or a binarized image
 * (adaptive threshold -> CCITT G4 -> 1-bit PDF image).
 *
 * Message protocol:
 *   Request:  { id: number, pages: PageDescriptor[] }
 *   Response: { ok: true, id: number, data: ArrayBuffer }
 *           | { ok: false, id: number, error: string }
 */

import {
  PDFDocument,
  PDFName,
  PDFRawStream,
  PDFDict,
  PDFNumber,
  PDFOperator,
  PDFOperatorNames,
} from "pdf-lib";
import { encode } from "ts-ccitt-g4-encoder";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface JpegPage {
  type: "jpeg";
  jpegBytes: ArrayBuffer;
  width: number;
  height: number;
}

interface BinarizePage {
  type: "binarize";
  rgbaBytes: ArrayBuffer;
  width: number;
  height: number;
  blockRadiusBps: number;
  contrastOffset: number;
  upsamplingScale: number;
}

type PageDescriptor = JpegPage | BinarizePage;

interface ExportRequest {
  id: number;
  pages: PageDescriptor[];
}

// ---------------------------------------------------------------------------
// PDF sizing: longest side maps to 297 mm (A4 height)
// ---------------------------------------------------------------------------

function pdfScale(w: number, h: number): number {
  return ((297 / 25.4) * 72) / Math.max(w, h);
}

// ---------------------------------------------------------------------------
// Binarization pipeline (grayscale -> upscale -> adaptive threshold -> 1-bit)
// ---------------------------------------------------------------------------

function binarizeToG4(
  rgbaBytes: ArrayBuffer,
  srcW: number,
  srcH: number,
  blockRadiusBps: number,
  contrastOffset: number,
  upsamplingScale: number,
): { g4Data: Uint8Array; width: number; height: number } {
  const rgba = new Uint8Array(rgbaBytes);
  const scale = upsamplingScale / 100;
  const upW = Math.max(1, Math.round(srcW * scale));
  const upH = Math.max(1, Math.round(srcH * scale));

  // Upscale via OffscreenCanvas (hardware-accelerated bilinear interpolation)
  const srcCanvas = new OffscreenCanvas(srcW, srcH);
  const srcCtx = srcCanvas.getContext("2d")!;
  const srcImgData = srcCtx.createImageData(srcW, srcH);
  srcImgData.data.set(rgba);
  srcCtx.putImageData(srcImgData, 0, 0);

  const upCanvas = new OffscreenCanvas(upW, upH);
  const upCtx = upCanvas.getContext("2d")!;
  upCtx.drawImage(srcCanvas, 0, 0, upW, upH);

  const upImgData = upCtx.getImageData(0, 0, upW, upH);
  const pixels = upImgData.data;

  // Grayscale conversion (ITU-R BT.601 luma)
  const gray = new Uint8Array(upW * upH);
  for (let i = 0; i < gray.length; i++) {
    const off = i * 4;
    gray[i] = Math.round(
      0.299 * pixels[off] + 0.587 * pixels[off + 1] + 0.114 * pixels[off + 2],
    );
  }

  // Block radius: sqrt(W * H * bps / 10000), clamped to min(W, H)
  const blockRadius = Math.max(
    1,
    Math.min(
      Math.min(upW, upH),
      Math.round(Math.sqrt((upW * upH * blockRadiusBps) / 10000)),
    ),
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

  // Adaptive threshold -> 1-bit MSB-first flat bitstream packing
  // ts-ccitt-g4-encoder expects a flat bitstream (no row padding):
  //   byteIndex = floor((y * width + x) / 8)
  // Convention: 1 = black (dark), 0 = white (light) — matches library's binarizeToBitPacked
  const totalPixels = upW * upH;
  const bitPacked = new Uint8Array(Math.ceil(totalPixels / 8));

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
      const isBlack = gray[y * upW + x] < threshold;

      if (isBlack) {
        // Black = 1, MSB-first, flat bitstream (no row padding)
        const bitIndex = y * upW + x;
        bitPacked[bitIndex >> 3] |= 0x80 >> (bitIndex & 7);
      }
      // White = 0 (already zero-initialized)
    }
  }

  // CCITT Group 4 encoding
  const g4Data = encode(bitPacked, upW, upH);

  return { g4Data, width: upW, height: upH };
}

// ---------------------------------------------------------------------------
// PDF construction
// ---------------------------------------------------------------------------

async function buildPdf(pages: PageDescriptor[]): Promise<ArrayBuffer> {
  const pdfDoc = await PDFDocument.create();
  const context = pdfDoc.context;

  for (const desc of pages) {
    if (desc.type === "jpeg") {
      // --- JPEG path: use pdf-lib's high-level embedJpg ---
      const jpgImage = await pdfDoc.embedJpg(desc.jpegBytes);
      const scale = pdfScale(desc.width, desc.height);
      const pageW = desc.width * scale;
      const pageH = desc.height * scale;
      const page = pdfDoc.addPage([pageW, pageH]);
      page.drawImage(jpgImage, { x: 0, y: 0, width: pageW, height: pageH });
    } else {
      // --- Binarize path: adaptive threshold -> CCITT G4 -> manual XObject ---
      const { g4Data, width, height } = binarizeToG4(
        desc.rgbaBytes,
        desc.width,
        desc.height,
        desc.blockRadiusBps,
        desc.contrastOffset,
        desc.upsamplingScale,
      );

      const scale = pdfScale(width, height);
      const pageW = width * scale;
      const pageH = height * scale;

      // Build the image XObject dictionary
      const imgDict = context.obj({
        Type: "XObject",
        Subtype: "Image",
        Width: width,
        Height: height,
        ColorSpace: "DeviceGray",
        BitsPerComponent: 1,
        Filter: "CCITTFaxDecode",
        DecodeParms: {
          K: -1,
          Columns: width,
          Rows: height,
          BlackIs1: true,
        },
        Length: g4Data.length,
      });

      // Create a raw stream with the G4 data and register it
      const imgStream = PDFRawStream.of(imgDict as PDFDict, g4Data);
      const imgRef = context.register(imgStream);

      // Create the page
      const page = pdfDoc.addPage([pageW, pageH]);

      // Add the image as an XObject resource on the page
      const imgName = PDFName.of("Img0");
      page.node.setXObject(imgName, imgRef);

      // Build a content stream to draw the image: q W 0 0 H 0 0 cm /Img0 Do Q
      const drawOps = [
        PDFOperator.of(PDFOperatorNames.PushGraphicsState),
        PDFOperator.of(PDFOperatorNames.ConcatTransformationMatrix, [
          PDFNumber.of(pageW),
          PDFNumber.of(0),
          PDFNumber.of(0),
          PDFNumber.of(pageH),
          PDFNumber.of(0),
          PDFNumber.of(0),
        ]),
        PDFOperator.of(PDFOperatorNames.DrawObject, [imgName]),
        PDFOperator.of(PDFOperatorNames.PopGraphicsState),
      ];

      const contentStream = context.contentStream(drawOps);
      const contentStreamRef = context.register(contentStream);
      page.node.addContentStream(contentStreamRef);
    }
  }

  const pdfBytes = await pdfDoc.save();
  return pdfBytes.buffer.slice(
    pdfBytes.byteOffset,
    pdfBytes.byteOffset + pdfBytes.byteLength,
  ) as ArrayBuffer;
}

// ---------------------------------------------------------------------------
// Worker message handler
// ---------------------------------------------------------------------------

self.onmessage = async (e: MessageEvent<ExportRequest>) => {
  const { id, pages } = e.data;
  try {
    const data = await buildPdf(pages);
    (self as unknown as Worker).postMessage(
      { ok: true, id, data },
      [data],
    );
  } catch (err) {
    (self as unknown as Worker).postMessage({
      ok: false,
      id,
      error: err instanceof Error ? err.message : String(err),
    });
  }
};
