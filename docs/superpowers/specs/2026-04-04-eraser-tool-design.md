# Eraser Tool for B&W Filter — Design Spec

## Goal

Allow users to erase (fill white) regions on B&W-filtered images using brush or lasso tools directly on the Crop Preview. Erased regions persist through export (JPEG/ZIP/PDF) and integrate with the existing undo/redo system.

## Constraints

- Only available when B&W filter is active (`filterConfig.type === "binarize"`)
- Modifying any B&W filter parameter (`blockRadiusBps`, `contrastOffset`, `upsamplingScale`) automatically clears the erase mask
- All processing is client-side (no backend)
- Must work at full source resolution for export quality

## Data Model

### EditState Extension

```typescript
interface EditState {
  corners: [number, number][];
  edgeFits: EdgeFit[];
  rotation: 0 | 90 | 180 | 270;
  filterConfig: FilterConfig;
  eraseMask: EraseMask | null;  // NEW
}

interface EraseMask {
  width: number;                // matches filteredCanvas dimensions
  height: number;
  data: Uint8Array;             // single-channel mask: 255 = erased (white), 0 = keep
}
```

**Why `Uint8Array` instead of `ImageData`:** Smaller memory footprint (1 channel vs 4), faster to clone for undo/redo, and simpler to serialize. The mask dimensions match `filteredCanvas` (which is the binarized crop at upsampled resolution).

**Why not store as canvas:** Deep cloning canvases for undo/redo is expensive and error-prone. A typed array is trivially cloned with `new Uint8Array(existing)`.

### Auto-Clear on Filter Change

In the AppContext reducer, the `SET_EDIT_STATE` handler must detect when `filterConfig.binarize` parameters change and automatically set `eraseMask` to `null`. Specifically: if the previous `editState.filterConfig.binarize` differs from the new one (by value comparison of `blockRadiusBps`, `contrastOffset`, `upsamplingScale`), clear `eraseMask`.

The `BATCH_SET_FILTER` action also clears `eraseMask` on all affected images.

## Interaction Model

### Entering/Exiting Eraser Mode

- **Enter:** ToolPanel shows an "Eraser" toggle button in the Filter section (only when B&W is active). Clicking activates eraser mode.
- **Exit:** Click the Eraser button again, or press `Escape`.
- **State:** `eraserActive: boolean` lives in `EditorScreen` component state (not in AppContext — it's a UI mode, not document state).

### Tool Selection

Two sub-tools, selectable via ToolPanel buttons when eraser mode is active:

1. **Brush (default)** — Free-paint eraser
   - Mouse down + drag paints on the eraseMask
   - Circular brush, configurable radius via ToolPanel slider (range: 5–100px in source coordinates, default 20)
   - Visual cursor shows brush size on the Crop Preview canvas
   - Each mousedown→mouseup is one undo-able operation

2. **Lasso** — Region fill eraser
   - Mouse down + drag draws a freehand path (rendered as a thin line on the preview)
   - Mouse up closes the path and fills the enclosed region with white on the eraseMask
   - Each lasso fill is one undo-able operation
   - Uses canvas `fill()` with the path to determine which pixels are inside

### Brush Size Control

- ToolPanel slider: "Brush Size" (range 5–100, step 1, default 20)
- Only visible when eraser mode is active and brush tool is selected
- Value is in source-resolution pixels

### Clear All Eraser

- "Clear Eraser" button in ToolPanel, visible when eraser mode is active and `eraseMask` is non-null
- Pushes history before clearing
- Sets `eraseMask` to `null`

## Rendering Pipeline

### Current Flow (unchanged)
```
cropCanvas → binarize worker → filteredCanvas
```

### New Flow
```
cropCanvas → binarize worker → filteredCanvas → apply eraseMask → displayCanvas
```

**Apply eraseMask step:** A pure function `applyEraseMask(filteredCanvas, eraseMask) → HTMLCanvasElement` that:
1. Creates a new canvas same size as filteredCanvas
2. Draws filteredCanvas onto it
3. Iterates eraseMask: for each pixel where `mask[i] === 255`, sets the corresponding RGBA pixel to `(255, 255, 255, 255)`
4. Returns the new canvas

This function runs:
- In `EditorScreen` after `filteredCanvas` is computed (for display in CropPreview)
- In export paths (TopBar `handleExport`, `handleExportAll`, PDF export)

The result is stored as `displayCanvas` on the ImageEntry (new field) or composed inline at export time.

### Where to Store the Erased Result

**Option chosen:** Compose inline. Do NOT add a new `displayCanvas` field to ImageEntry. Instead:
- CropPreview reads `filteredCanvas` + `eraseMask` and applies the mask during its `draw()` call
- Export functions apply the mask inline before exporting

This avoids another async state update cycle and keeps ImageEntry simpler.

## Coordinate Mapping (Crop Preview → Source)

The Crop Preview canvas displays at CSS size `(cssW, cssH)` with DPR backing `(cssW*dpr, cssH*dpr)`, representing a source image of `(srcW, srcH)`.

Mouse coordinate mapping:
```
clientX/Y → canvas CSS-relative position → source pixel
sourceX = (clientX - canvasRect.left) / canvasRect.width * srcW
sourceY = (clientY - canvasRect.top) / canvasRect.height * srcH
```

The eraseMask dimensions match the filteredCanvas dimensions, which equal the source dimensions after binarize upscaling. So `sourceX/sourceY` map directly to eraseMask coordinates.

## CropPreview Changes

When eraser mode is active, CropPreview needs to:

1. **Show eraser cursor:** Custom cursor showing brush size (circle) or crosshair (lasso)
2. **Handle mouse events:** mousedown/mousemove/mouseup for painting or lasso drawing
3. **Render erase preview:** During brush drag, show the stroke in real-time on the canvas
4. **Apply eraseMask:** In `draw()`, after drawing the filteredCanvas, apply the eraseMask overlay

**Props added to CropPreview:**
```typescript
interface CropPreviewProps {
  eraserActive: boolean;
  eraserTool: "brush" | "lasso";
  brushSize: number;
  onErase: (mask: EraseMask) => void;  // callback to update eraseMask in state
}
```

These are passed from EditorScreen which manages the eraser UI state.

## ToolPanel Changes

When B&W filter is active, add below the filter sliders:

```
[Eraser]                    ← toggle button (accent when active)

When eraser active:
  [Brush] [Lasso]           ← tool selection (brush default)
  Brush Size  [====o====]   ← slider, only for brush mode
  [Clear Eraser]            ← visible when eraseMask exists
```

## Undo/Redo Integration

`eraseMask` is part of `EditState`, so `cloneEditState()` must deep-copy it:
```typescript
eraseMask: s.eraseMask
  ? { width: s.eraseMask.width, height: s.eraseMask.height, data: new Uint8Array(s.eraseMask.data) }
  : null
```

Each brush stroke or lasso fill:
1. `PUSH_HISTORY` (saves current eraseMask state)
2. Update `eraseMask` with new erased pixels
3. `SET_EDIT_STATE` with updated eraseMask

Undo restores the previous eraseMask. Redo re-applies.

## Export Integration

### JPEG / ZIP Export (TopBar.tsx)

Current flow:
```
sourceCanvas = filteredCanvas ?? cropCanvas
final = rotateCanvas(sourceCanvas, rotation)
final.toBlob(...)
```

New flow when B&W + eraseMask:
```
sourceCanvas = filteredCanvas
erased = applyEraseMask(sourceCanvas, eraseMask)  // NEW
final = rotateCanvas(erased, rotation)
final.toBlob(...)
```

### PDF Export (pdfExport.ts / pdfExport.worker.ts)

The PDF worker receives image data from the main thread. The erase mask must be applied BEFORE sending to the worker. The main thread applies `applyEraseMask()` to the filteredCanvas, then sends the erased result to the worker as before.

## File Structure

| File | Change |
|------|--------|
| `src/lib/types.ts` | Add `EraseMask` interface, add `eraseMask` to `EditState` |
| `src/lib/eraser.ts` | NEW: `applyEraseMask()`, `paintBrushStroke()`, `fillLassoRegion()` |
| `src/context/AppContext.tsx` | Clone `eraseMask` in `cloneEditState`, auto-clear on binarize param change |
| `src/components/CropPreview.tsx` | Accept eraser props, handle mouse events, render erase overlay |
| `src/components/ToolPanel.tsx` | Eraser toggle, tool selector, brush size slider, clear button |
| `src/components/EditorScreen.tsx` | Manage `eraserActive`, `eraserTool`, `brushSize` state, wire props |
| `src/components/TopBar.tsx` | Apply eraseMask in export flows |
| `src/lib/pdfExport.ts` | Apply eraseMask before sending to worker |

## Edge Cases

- **Switching images while eraser is active:** Exit eraser mode (set `eraserActive = false`)
- **Toggling B&W off while eraser is active:** Exit eraser mode, eraseMask becomes irrelevant (preserved but not displayed)
- **Toggling B&W back on:** eraseMask is still there (if params didn't change), re-applied
- **Cancelling crop:** eraseMask is cleared with editState
- **Reset to prediction:** eraseMask is cleared (editStateFromQuad sets it to null)
- **filteredCanvas not yet computed:** eraser button is disabled until filteredCanvas exists
- **Batch filter change:** clears eraseMask on all images
