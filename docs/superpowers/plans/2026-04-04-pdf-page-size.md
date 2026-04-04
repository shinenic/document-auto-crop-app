# PDF Page Size Customization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add configurable PDF page size with music score publisher presets, auto-detect, landscape options, and consistent page dimensions across all pages.

**Architecture:** `PdfPageSize` presets in `types.ts` include music publisher sizes (9×12", Euro, Large), standard sizes (A4, A3, Letter), and landscape variants. `detectBestPageSize()` picks the closest preset based on average cropped image dimensions. TopBar has a dropdown to select page size. The worker creates fixed-size pages and centers images with object-contain fit + 5mm margin.

**Tech Stack:** pdf-lib (existing), worker message protocol extension

---

## Progress

- [x] **Task 1: Types + presets** — `PdfPageSize`, `PDF_PAGE_SIZES`, `detectBestPageSize()` (commit `459b9ea`)
- [x] **Task 2: Worker layout** — `getPageLayout` with fixed/fit modes, portrait/landscape auto-detect (commit `217825d`)
- [ ] **Task 3: exportPdf + TopBar UI** — Pass pageSize to worker, add dropdown + auto-detect in TopBar

## Page Size Presets

| Label | Width (mm) | Height (mm) | Notes |
|-------|-----------|-------------|-------|
| Auto Detect | — | — | Picks closest preset from average image dimensions |
| Music 9×12″ | 229 | 305 | Schirmer, IMC, Boosey & Hawkes |
| Music Euro | 235 | 310 | Henle, Peters, Universal Edition |
| Music Large | 240 | 325 | Bärenreiter, Breitkopf & Härtel |
| A4 | 210 | 297 | Standard (Hal Leonard etc.) |
| A3 | 297 | 420 | Large format |
| Letter | 215.9 | 279.4 | North America |
| A4 Landscape | 297 | 210 | Landscape |
| Music 12×9″ | 305 | 229 | Landscape music |
| A3 Landscape | 420 | 297 | Landscape large |
| Fit to Image | — | — | Each page matches its image (current behavior) |

## Remaining Task

### Task 3: Pass pageSize to exportPdf + TopBar Dropdown

**Files:**
- Modify: `src/lib/pdfExport.ts`
- Modify: `src/components/TopBar.tsx`

**pdfExport.ts changes:**

Update `exportPdf` signature to accept `pageSize`:
```typescript
export async function exportPdf(
  images: ImageEntry[],
  pageSize?: { widthMm: number; heightMm: number },
  onProgress?: (current: number, total: number) => void,
): Promise<Blob> {
```

Pass `pageSizeMm` in the worker postMessage:
```typescript
w.postMessage({ id, pages, pageSizeMm: pageSize }, transferables);
```

**TopBar.tsx changes:**

- Import `PDF_PAGE_SIZES`, `PdfPageSize`, `detectBestPageSize`
- Add state: `const [pdfPageSize, setPdfPageSize] = useState<PdfPageSize>(PDF_PAGE_SIZES[0])` (Auto Detect default)
- In `handleExportPdf`: resolve auto-detect to actual size, pass to `exportPdf()`
- Add a `<select>` dropdown next to the Download PDF button
- Auto-detect resolves by calling `detectBestPageSize()` with ready images' crop dimensions at export time
