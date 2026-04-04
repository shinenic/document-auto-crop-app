# PDF Page Size Customization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add configurable PDF page size (A4, A3, Letter, Legal, Fit to Image) with consistent page dimensions across all pages, fitting images with whitespace (object-contain style).

**Architecture:** A `PdfPageSize` type defines preset sizes in mm. The page size is passed from TopBar through `exportPdf()` to the worker. The worker's `buildPdf` creates fixed-size pages and centers the image within them. "Fit to Image" preserves the current per-page sizing behavior. Image DPI is determined by source pixel count vs. page physical size.

**Tech Stack:** pdf-lib (existing), worker message protocol extension

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `src/lib/types.ts` | Modify | Add `PdfPageSize` type and `PDF_PAGE_SIZES` constant |
| `src/lib/pdfExport.ts` | Modify | Accept `pageSize` param, pass to worker |
| `src/lib/pdfExport.worker.ts` | Modify | Update `buildPdf` to support fixed page sizes with centered fit |
| `src/components/TopBar.tsx` | Modify | Add page size dropdown, pass selection to `exportPdf` |

---

### Task 1: Add PdfPageSize Type and Presets

**Files:**
- Modify: `src/lib/types.ts`

- [ ] **Step 1: Add PdfPageSize type and PDF_PAGE_SIZES constant**

At the end of `src/lib/types.ts` (after `MAX_PREVIEW_SIZE`), add:

```typescript
// --- PDF Page Sizes ---

export interface PdfPageSize {
  label: string;
  widthMm: number;   // 0 = fit to image
  heightMm: number;  // 0 = fit to image
}

export const PDF_PAGE_SIZES: PdfPageSize[] = [
  { label: "A4", widthMm: 210, heightMm: 297 },
  { label: "A3", widthMm: 297, heightMm: 420 },
  { label: "Letter", widthMm: 215.9, heightMm: 279.4 },
  { label: "Legal", widthMm: 215.9, heightMm: 355.6 },
  { label: "Fit to Image", widthMm: 0, heightMm: 0 },
];
```

- [ ] **Step 2: Verify build**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/types.ts
git commit -m "feat: add PdfPageSize type and preset page size constants"
```

---

### Task 2: Update Worker to Support Fixed Page Sizes

**Files:**
- Modify: `src/lib/pdfExport.worker.ts`

- [ ] **Step 1: Update ExportRequest and pdfScale in the worker**

In `src/lib/pdfExport.worker.ts`:

Update the `ExportRequest` interface to include page size:
```typescript
interface ExportRequest {
  id: number;
  pages: PageDescriptor[];
  pageSizeMm?: { widthMm: number; heightMm: number }; // null/undefined = fit to image
}
```

Replace the `pdfScale` function with a more flexible `getPageDimensions`:

```typescript
// ---------------------------------------------------------------------------
// PDF sizing
// ---------------------------------------------------------------------------

/** Convert mm to PDF points (1pt = 1/72 inch) */
function mmToPt(mm: number): number {
  return (mm / 25.4) * 72;
}

/**
 * Compute page dimensions and image placement.
 * Fixed page size: image is centered with object-contain fit.
 * Fit to image: longest side maps to 297mm (A4 height).
 */
function getPageLayout(
  imgW: number,
  imgH: number,
  pageSizeMm?: { widthMm: number; heightMm: number },
): { pageW: number; pageH: number; imgX: number; imgY: number; imgDrawW: number; imgDrawH: number } {
  if (!pageSizeMm || (pageSizeMm.widthMm === 0 && pageSizeMm.heightMm === 0)) {
    // Fit to image: longest side = 297mm
    const scale = ((297 / 25.4) * 72) / Math.max(imgW, imgH);
    const w = imgW * scale;
    const h = imgH * scale;
    return { pageW: w, pageH: h, imgX: 0, imgY: 0, imgDrawW: w, imgDrawH: h };
  }

  // Fixed page size — auto-detect portrait/landscape based on image aspect
  const imgAspect = imgW / imgH;
  let pageWMm = pageSizeMm.widthMm;
  let pageHMm = pageSizeMm.heightMm;

  // If image is landscape and page is portrait, swap page orientation
  if (imgAspect > 1 && pageWMm < pageHMm) {
    [pageWMm, pageHMm] = [pageHMm, pageWMm];
  }
  // If image is portrait and page is landscape, swap back
  if (imgAspect <= 1 && pageWMm > pageHMm) {
    [pageWMm, pageHMm] = [pageHMm, pageWMm];
  }

  const pageW = mmToPt(pageWMm);
  const pageH = mmToPt(pageHMm);

  // Fit image inside page (object-contain) with small margin
  const margin = mmToPt(5); // 5mm margin
  const availW = pageW - margin * 2;
  const availH = pageH - margin * 2;
  const scale = Math.min(availW / imgW, availH / imgH);
  const imgDrawW = imgW * scale;
  const imgDrawH = imgH * scale;

  // Center the image
  const imgX = (pageW - imgDrawW) / 2;
  const imgY = (pageH - imgDrawH) / 2;

  return { pageW, pageH, imgX, imgY, imgDrawW, imgDrawH };
}
```

- [ ] **Step 2: Update buildPdf to use getPageLayout**

Update `buildPdf` to accept `pageSizeMm` and use the new layout function:

Change the function signature:
```typescript
async function buildPdf(
  pages: PageDescriptor[],
  pageSizeMm?: { widthMm: number; heightMm: number },
): Promise<ArrayBuffer> {
```

Replace the JPEG path page creation (currently uses `pdfScale`):
```typescript
    if (desc.type === "jpeg") {
      const jpgImage = await pdfDoc.embedJpg(desc.jpegBytes);
      const layout = getPageLayout(desc.width, desc.height, pageSizeMm);
      const page = pdfDoc.addPage([layout.pageW, layout.pageH]);
      page.drawImage(jpgImage, {
        x: layout.imgX,
        y: layout.imgY,
        width: layout.imgDrawW,
        height: layout.imgDrawH,
      });
    }
```

Replace the binarize path page creation:
```typescript
    else {
      const { g4Data, width, height } = binarizeToG4(
        desc.rgbaBytes,
        desc.width,
        desc.height,
        desc.blockRadiusBps,
        desc.contrastOffset,
        desc.upsamplingScale,
      );

      const layout = getPageLayout(width, height, pageSizeMm);

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
          BlackIs1: false,
        },
        Length: g4Data.length,
      });

      const imgStream = PDFRawStream.of(imgDict as PDFDict, g4Data);
      const imgRef = context.register(imgStream);

      const page = pdfDoc.addPage([layout.pageW, layout.pageH]);
      const imgName = PDFName.of("Img0");
      page.node.setXObject(imgName, imgRef);

      const drawOps = [
        PDFOperator.of(PDFOperatorNames.PushGraphicsState),
        PDFOperator.of(PDFOperatorNames.ConcatTransformationMatrix, [
          PDFNumber.of(layout.imgDrawW),
          PDFNumber.of(0),
          PDFNumber.of(0),
          PDFNumber.of(layout.imgDrawH),
          PDFNumber.of(layout.imgX),
          PDFNumber.of(layout.imgY),
        ]),
        PDFOperator.of(PDFOperatorNames.DrawObject, [imgName]),
        PDFOperator.of(PDFOperatorNames.PopGraphicsState),
      ];

      const contentStream = context.contentStream(drawOps);
      const contentStreamRef = context.register(contentStream);
      page.node.addContentStream(contentStreamRef);
    }
```

- [ ] **Step 3: Update the worker message handler to pass pageSizeMm**

Update the `onmessage` handler:
```typescript
self.onmessage = async (e: MessageEvent<ExportRequest>) => {
  const { id, pages, pageSizeMm } = e.data;
  try {
    const data = await buildPdf(pages, pageSizeMm);
```

- [ ] **Step 4: Remove the old pdfScale function**

Delete:
```typescript
function pdfScale(w: number, h: number): number {
  return ((297 / 25.4) * 72) / Math.max(w, h);
}
```

- [ ] **Step 5: Verify build**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/pdfExport.worker.ts
git commit -m "feat: support fixed page sizes with centered image fit in PDF worker"
```

---

### Task 3: Update exportPdf to Accept Page Size

**Files:**
- Modify: `src/lib/pdfExport.ts`

- [ ] **Step 1: Add pageSize parameter to exportPdf**

Update the `exportPdf` function signature:

```typescript
export async function exportPdf(
  images: ImageEntry[],
  pageSize?: { widthMm: number; heightMm: number },
  onProgress?: (current: number, total: number) => void,
): Promise<Blob> {
```

Update the worker postMessage to include pageSize:

Replace:
```typescript
    w.postMessage({ id, pages }, transferables);
```
with:
```typescript
    w.postMessage(
      { id, pages, pageSizeMm: pageSize },
      transferables,
    );
```

- [ ] **Step 2: Verify build**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/pdfExport.ts
git commit -m "feat: pass page size parameter through to PDF export worker"
```

---

### Task 4: Add Page Size Dropdown to TopBar

**Files:**
- Modify: `src/components/TopBar.tsx`

- [ ] **Step 1: Add page size state and dropdown UI**

Add the import at the top:
```typescript
import { PDF_PAGE_SIZES } from "../lib/types";
import type { PdfPageSize } from "../lib/types";
```

Add state after the existing `useState` calls:
```typescript
  const [pdfPageSize, setPdfPageSize] = useState<PdfPageSize>(PDF_PAGE_SIZES[0]); // A4 default
```

Update `handleExportPdf` to pass the page size:

Replace:
```typescript
      const pdfBlob = await exportPdf(state.images);
```
with:
```typescript
      const pageSize = pdfPageSize.widthMm > 0
        ? { widthMm: pdfPageSize.widthMm, heightMm: pdfPageSize.heightMm }
        : undefined;
      const pdfBlob = await exportPdf(state.images, pageSize);
```

Add a page size dropdown next to the PDF export button. Replace the current "Download PDF" button:

```tsx
        <select
          className="px-2 py-1.5 text-xs font-medium rounded-lg bg-[var(--bg-tertiary)] text-[var(--text-secondary)] border border-[var(--border)] cursor-pointer"
          value={pdfPageSize.label}
          onChange={(e) => {
            const found = PDF_PAGE_SIZES.find((s) => s.label === e.target.value);
            if (found) setPdfPageSize(found);
          }}
        >
          {PDF_PAGE_SIZES.map((s) => (
            <option key={s.label} value={s.label}>
              {s.label}
            </option>
          ))}
        </select>
        <button
          className="px-3 py-1.5 text-xs font-medium rounded-lg bg-[var(--accent)] text-[var(--bg-primary)] hover:bg-[var(--accent-hover)] transition-colors disabled:opacity-40 flex items-center gap-1.5"
          onClick={handleExportPdf}
          disabled={readyCount === 0 || exportingPdf}
        >
          {exportingPdf && (
            <span className="inline-block w-3 h-3 border-2 border-[var(--bg-primary)] border-t-transparent rounded-full animate-spin" />
          )}
          {exportingPdf ? "Exporting..." : `Download PDF (${readyCount})`}
        </button>
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/components/TopBar.tsx
git commit -m "feat: add PDF page size dropdown with A4/A3/Letter/Legal/Fit presets"
```

---

## Self-Review

**1. Spec coverage:**
- ✅ Fixed page sizes: A4, A3, Letter, Legal → Task 1 (`PDF_PAGE_SIZES`)
- ✅ "Fit to Image" preserves current behavior → Task 2 (`getPageLayout` with widthMm=0)
- ✅ Consistent page size across all pages → Task 2 (same `pageSizeMm` for every page)
- ✅ Image fit with whitespace (object-contain) → Task 2 (`getPageLayout` centers with margin)
- ✅ Auto portrait/landscape per image → Task 2 (swaps page orientation based on aspect ratio)
- ✅ DPI determined by source pixels / physical size → inherent (more pixels = higher DPI)
- ✅ Page size dropdown in TopBar → Task 4
- ✅ Default A4 → Task 4 (`PDF_PAGE_SIZES[0]`)

**2. Placeholder scan:** No TBD/TODO found.

**3. Type consistency:**
- `PdfPageSize` defined in types.ts, used in TopBar
- `PDF_PAGE_SIZES` defined in types.ts, used in TopBar
- `pageSizeMm?: { widthMm: number; heightMm: number }` consistent across pdfExport.ts, pdfExport.worker.ts, ExportRequest
- `getPageLayout` returns `{ pageW, pageH, imgX, imgY, imgDrawW, imgDrawH }` used consistently in both JPEG and binarize paths
