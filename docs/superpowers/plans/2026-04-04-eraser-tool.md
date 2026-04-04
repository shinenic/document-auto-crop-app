# Eraser Tool Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add brush and lasso eraser tools that fill regions white on B&W-filtered crop previews, with undo/redo and export integration.

**Architecture:** `EraseMask` (a `Uint8Array` matching `filteredCanvas` dimensions) is stored in `EditState`. Three pure functions in `src/lib/eraser.ts` handle mask operations. CropPreview gains mouse interaction for brush/lasso painting. The eraseMask is applied inline at render and export time — no new ImageEntry fields.

**Tech Stack:** React 19, Canvas 2D API, existing undo/redo system via AppContext

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `src/lib/types.ts` | Modify | Add `EraseMask` interface, add `eraseMask` to `EditState` |
| `src/lib/eraser.ts` | Create | `applyEraseMask()`, `paintBrushStroke()`, `fillLassoRegion()` |
| `src/context/AppContext.tsx` | Modify | Clone `eraseMask` in `cloneEditState`, add `eraseMask: null` to `editStateFromQuad`, auto-clear on binarize param change in `SET_EDIT_STATE`, clear in `BATCH_SET_FILTER` |
| `src/components/EditorScreen.tsx` | Modify | Add `eraserActive`, `eraserTool`, `brushSize` state; pass as props to CropPreview and ToolPanel; exit eraser on image switch |
| `src/components/ToolPanel.tsx` | Modify | Eraser toggle button, Brush/Lasso selector, brush size slider, Clear Eraser button |
| `src/components/CropPreview.tsx` | Modify | Accept eraser props, mouse event handlers for brush/lasso, render eraseMask overlay, apply mask in draw() |
| `src/components/TopBar.tsx` | Modify | Apply eraseMask before export in handleExport and handleExportAll |
| `src/lib/pdfExport.ts` | Modify | Apply eraseMask before sending to worker |

---

### Task 1: Add EraseMask Type and eraser.ts Utility Functions

**Files:**
- Modify: `src/lib/types.ts`
- Create: `src/lib/eraser.ts`

- [ ] **Step 1: Add EraseMask interface and update EditState in types.ts**

In `src/lib/types.ts`, add the `EraseMask` interface after the `FilterConfig` constants (after line 44), and add `eraseMask` to `EditState`:

Add after the `DEFAULT_FILTER_CONFIG` constant:
```typescript
export interface EraseMask {
  width: number;
  height: number;
  data: Uint8Array; // single-channel: 255 = erased (white), 0 = keep
}
```

Update `EditState` to include `eraseMask`:
```typescript
export interface EditState {
  corners: [number, number][];
  edgeFits: EdgeFit[];
  rotation: 0 | 90 | 180 | 270;
  filterConfig: FilterConfig;
  eraseMask: EraseMask | null;
}
```

- [ ] **Step 2: Create src/lib/eraser.ts with three utility functions**

Create `src/lib/eraser.ts`:

```typescript
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

  // Only apply if dimensions match
  const len = Math.min(mask.length, out.width * out.height);
  for (let i = 0; i < len; i++) {
    if (mask[i] === 255) {
      const j = i * 4;
      pixels[j] = 255;     // R
      pixels[j + 1] = 255; // G
      pixels[j + 2] = 255; // B
      pixels[j + 3] = 255; // A
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

  // Compute bounding box for the lasso region
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

  // Rasterize the polygon using an OffscreenCanvas
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

  // Read back and merge into mask
  const id = ctx.getImageData(0, 0, bw, bh);
  const px = id.data;
  for (let ly = 0; ly < bh; ly++) {
    for (let lx = 0; lx < bw; lx++) {
      // Check alpha channel of rasterized polygon
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
```

- [ ] **Step 3: Verify build**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/types.ts src/lib/eraser.ts
git commit -m "feat: add EraseMask type and eraser utility functions"
```

---

### Task 2: Update AppContext for EraseMask Support

**Files:**
- Modify: `src/context/AppContext.tsx`

- [ ] **Step 1: Update cloneEditState to deep-copy eraseMask**

In `src/context/AppContext.tsx`, update the `cloneEditState` function. Add the `eraseMask` cloning and import `cloneEraseMask`:

Add to the imports at the top:
```typescript
import { cloneEraseMask } from "../lib/eraser";
```

Update `cloneEditState` (currently lines 41-55) to add `eraseMask`:
```typescript
function cloneEditState(s: EditState): EditState {
  return {
    corners: s.corners.map((c) => [...c] as [number, number]),
    edgeFits: s.edgeFits.map((f) => ({
      cp1: [...f.cp1] as [number, number],
      cp2: [...f.cp2] as [number, number],
      isArc: f.isArc,
    })),
    rotation: s.rotation,
    filterConfig: {
      type: s.filterConfig.type,
      binarize: { ...s.filterConfig.binarize },
    },
    eraseMask: s.eraseMask ? cloneEraseMask(s.eraseMask) : null,
  };
}
```

- [ ] **Step 2: Update editStateFromQuad to include eraseMask: null**

Update `editStateFromQuad` (currently lines 57-71) to add `eraseMask: null`:
```typescript
export function editStateFromQuad(quad: QuadResult): EditState {
  return {
    corners: quad.corners.map((c) => [...c] as [number, number]),
    edgeFits: quad.edgeFits.map((f) => ({
      cp1: [...f.cp1] as [number, number],
      cp2: [...f.cp2] as [number, number],
      isArc: f.isArc,
    })),
    rotation: 0,
    filterConfig: {
      type: DEFAULT_FILTER_CONFIG.type,
      binarize: { ...DEFAULT_FILTER_CONFIG.binarize },
    },
    eraseMask: null,
  };
}
```

- [ ] **Step 3: Auto-clear eraseMask when binarize params change in SET_EDIT_STATE**

Update the `SET_EDIT_STATE` reducer case (currently lines 105-113). Detect when binarize params change and clear eraseMask:

```typescript
    case "SET_EDIT_STATE": {
      return {
        ...state,
        images: state.images.map((img) => {
          if (img.id !== action.id) return img;
          let editState = action.editState;
          // Auto-clear eraseMask when binarize params change
          if (editState && img.editState && editState.eraseMask) {
            const oldB = img.editState.filterConfig.binarize;
            const newB = editState.filterConfig.binarize;
            if (
              oldB.blockRadiusBps !== newB.blockRadiusBps ||
              oldB.contrastOffset !== newB.contrastOffset ||
              oldB.upsamplingScale !== newB.upsamplingScale
            ) {
              editState = { ...editState, eraseMask: null };
            }
          }
          return { ...img, editState };
        }),
      };
    }
```

- [ ] **Step 4: Clear eraseMask in BATCH_SET_FILTER**

Update the `BATCH_SET_FILTER` reducer case (currently lines 224-246). Add `eraseMask: null` to the returned editState:

```typescript
    case "BATCH_SET_FILTER":
      return {
        ...state,
        images: state.images.map((img) => {
          if (!img.editState) return img;
          const past = [
            ...img.history.past,
            cloneEditState(img.editState),
          ];
          if (past.length > MAX_HISTORY) past.shift();
          return {
            ...img,
            editState: {
              ...img.editState,
              filterConfig: {
                type: action.filterConfig.type,
                binarize: { ...action.filterConfig.binarize },
              },
              eraseMask: null,
            },
            history: { past, future: [] },
          };
        }),
      };
```

- [ ] **Step 5: Verify build**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 6: Commit**

```bash
git add src/context/AppContext.tsx
git commit -m "feat: integrate eraseMask into AppContext with undo/redo and auto-clear"
```

---

### Task 3: Add Eraser UI State to EditorScreen and ToolPanel

**Files:**
- Modify: `src/components/EditorScreen.tsx`
- Modify: `src/components/ToolPanel.tsx`

- [ ] **Step 1: Add eraser state to EditorScreen**

In `src/components/EditorScreen.tsx`, add eraser state after the existing `useState` calls (after line 30):

```typescript
  const [eraserActive, setEraserActive] = useState(false);
  const [eraserTool, setEraserTool] = useState<"brush" | "lasso">("brush");
  const [brushSize, setBrushSize] = useState(20);
```

- [ ] **Step 2: Exit eraser mode when switching images**

Add a `useEffect` that exits eraser mode when selectedImageId changes. Add after the eraser state declarations:

```typescript
  // Exit eraser mode when switching images
  useEffect(() => {
    setEraserActive(false);
  }, [state.selectedImageId]);
```

- [ ] **Step 3: Pass eraser props to ToolPanel**

Update the `<ToolPanel />` usage in EditorScreen JSX (currently line 249). Change from:
```tsx
        <ToolPanel />
```
to:
```tsx
        <ToolPanel
          eraserActive={eraserActive}
          onToggleEraser={() => setEraserActive((v) => !v)}
          eraserTool={eraserTool}
          onSetEraserTool={setEraserTool}
          brushSize={brushSize}
          onSetBrushSize={setBrushSize}
        />
```

- [ ] **Step 4: Pass eraser props to CropPreview**

Update the `<CropPreview />` usage in EditorScreen JSX (currently line 246). Change from:
```tsx
            <CropPreview />
```
to:
```tsx
            <CropPreview
              eraserActive={eraserActive}
              eraserTool={eraserTool}
              brushSize={brushSize}
            />
```

- [ ] **Step 5: Update ToolPanel to accept and use eraser props**

In `src/components/ToolPanel.tsx`, update the component signature. Change from:
```tsx
export default function ToolPanel() {
```
to:
```tsx
export default function ToolPanel({
  eraserActive,
  onToggleEraser,
  eraserTool,
  onSetEraserTool,
  brushSize,
  onSetBrushSize,
}: {
  eraserActive: boolean;
  onToggleEraser: () => void;
  eraserTool: "brush" | "lasso";
  onSetEraserTool: (tool: "brush" | "lasso") => void;
  brushSize: number;
  onSetBrushSize: (size: number) => void;
}) {
```

Add a `clearEraser` callback (after the existing `batchFilter` callback):
```typescript
  const clearEraser = useCallback(() => {
    if (!id || !selectedImage?.editState) return;
    dispatch({ type: "PUSH_HISTORY", id });
    dispatch({
      type: "SET_EDIT_STATE",
      id,
      editState: { ...selectedImage.editState, eraseMask: null },
    });
  }, [id, selectedImage, dispatch]);
```

Add the eraser UI in the Filter section. After the `isFilterActive && (...)` slider block and after the "Apply Filter to All" button, add:

```tsx
      {/* Eraser (only when B&W is active and filteredCanvas exists) */}
      {isFilterActive && selectedImage?.filteredCanvas && (
        <div>
          <h4 className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] mb-2">Eraser</h4>
          <div className="flex flex-col gap-1">
            <ToolButton
              label={eraserActive ? "Exit Eraser" : "Eraser"}
              onClick={onToggleEraser}
              variant={eraserActive ? "accent" : "default"}
            />
            {eraserActive && (
              <>
                <div className="flex gap-1">
                  <button
                    className={`flex-1 px-2 py-1.5 text-[10px] font-medium rounded-lg transition-colors ${
                      eraserTool === "brush"
                        ? "bg-[var(--accent-muted)] text-[var(--accent)]"
                        : "bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)]"
                    }`}
                    onClick={() => onSetEraserTool("brush")}
                  >
                    Brush
                  </button>
                  <button
                    className={`flex-1 px-2 py-1.5 text-[10px] font-medium rounded-lg transition-colors ${
                      eraserTool === "lasso"
                        ? "bg-[var(--accent-muted)] text-[var(--accent)]"
                        : "bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)]"
                    }`}
                    onClick={() => onSetEraserTool("lasso")}
                  >
                    Lasso
                  </button>
                </div>
                {eraserTool === "brush" && (
                  <Slider
                    label="Brush Size"
                    value={brushSize}
                    min={5}
                    max={100}
                    step={1}
                    disabled={false}
                    onPointerDown={() => {}}
                    onChange={onSetBrushSize}
                  />
                )}
                {selectedImage?.editState?.eraseMask && (
                  <ToolButton
                    label="Clear Eraser"
                    onClick={clearEraser}
                    variant="danger"
                  />
                )}
              </>
            )}
          </div>
        </div>
      )}
```

- [ ] **Step 6: Handle Escape to exit eraser mode**

In `src/components/EditorScreen.tsx`, add a `useEffect` for the Escape key. Add after the image-switch effect:

```typescript
  // Exit eraser mode on Escape
  useEffect(() => {
    if (!eraserActive) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setEraserActive(false);
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [eraserActive]);
```

- [ ] **Step 7: Verify build**

Run: `npx tsc --noEmit`
Expected: No errors (CropPreview will need its props updated in the next task, but since the props are optional for now it should compile).

Note: CropPreview doesn't accept these props yet. For this step to compile, either make the props optional in CropPreview or skip this verification and verify after Task 4.

- [ ] **Step 8: Commit**

```bash
git add src/components/EditorScreen.tsx src/components/ToolPanel.tsx
git commit -m "feat: add eraser UI controls to ToolPanel with brush/lasso selection"
```

---

### Task 4: Add Eraser Interaction to CropPreview

**Files:**
- Modify: `src/components/CropPreview.tsx`

This is the most complex task. CropPreview needs to:
1. Accept eraser props
2. Handle mouse events for brush painting and lasso drawing
3. Render the eraseMask overlay in `draw()`
4. Show brush cursor preview

- [ ] **Step 1: Update CropPreview to accept eraser props and add eraser state**

Update the component signature and add imports. At the top of `src/components/CropPreview.tsx`:

Add import:
```typescript
import { applyEraseMask, createEraseMask, paintBrushStroke, fillLassoRegion } from "../lib/eraser";
import type { EraseMask } from "../lib/types";
```

Update the component signature from:
```tsx
export default function CropPreview() {
```
to:
```tsx
export default function CropPreview({
  eraserActive = false,
  eraserTool = "brush",
  brushSize = 20,
}: {
  eraserActive?: boolean;
  eraserTool?: "brush" | "lasso";
  brushSize?: number;
}) {
```

Add `dispatch` from useApp:
```tsx
  const { state, dispatch } = useApp();
```

Add eraser-related refs after the existing refs:
```typescript
  // Eraser state refs (avoid re-renders during painting)
  const erasingRef = useRef(false);
  const brushPointsRef = useRef<[number, number][]>([]);
  const lassoPointsRef = useRef<[number, number][]>([]);
  const overlayRef = useRef<HTMLCanvasElement>(null);
```

- [ ] **Step 2: Add coordinate mapping helper**

Add a helper function to map client coordinates to source (eraseMask) coordinates. Add inside the component, after the refs:

```typescript
  const clientToSource = useCallback(
    (clientX: number, clientY: number): [number, number] | null => {
      const canvas = canvasRef.current;
      const info = scaleInfoRef.current;
      if (!canvas || !info) return null;
      const rect = canvas.getBoundingClientRect();
      const relX = (clientX - rect.left) / rect.width;
      const relY = (clientY - rect.top) / rect.height;
      if (relX < 0 || relX > 1 || relY < 0 || relY > 1) return null;
      return [relX * info.srcW, relY * info.srcH];
    },
    [],
  );
```

- [ ] **Step 3: Add getOrCreateMask helper**

Add a helper to get the current eraseMask or create one matching filteredCanvas:

```typescript
  const getOrCreateMask = useCallback((): EraseMask | null => {
    if (!selectedImage?.editState || !selectedImage.filteredCanvas) return null;
    const existing = selectedImage.editState.eraseMask;
    if (existing) return existing;
    const fc = selectedImage.filteredCanvas;
    return createEraseMask(fc.width, fc.height);
  }, [selectedImage]);
```

- [ ] **Step 4: Add eraser mouse handlers**

Add mouse event handlers for eraser mode. These replace the loupe behavior when eraser is active:

```typescript
  const handleEraserMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (!eraserActive || !selectedImage?.id) return;
      const pt = clientToSource(e.clientX, e.clientY);
      if (!pt) return;

      erasingRef.current = true;
      dispatch({ type: "PUSH_HISTORY", id: selectedImage.id });

      if (eraserTool === "brush") {
        brushPointsRef.current = [pt];
        // Paint first point immediately
        const mask = getOrCreateMask();
        if (mask) {
          paintBrushStroke(mask, [pt], brushSize);
          dispatch({
            type: "SET_EDIT_STATE",
            id: selectedImage.id,
            editState: { ...selectedImage.editState!, eraseMask: mask },
          });
        }
      } else {
        lassoPointsRef.current = [pt];
      }
    },
    [eraserActive, eraserTool, brushSize, selectedImage, clientToSource, getOrCreateMask, dispatch],
  );

  const handleEraserMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!erasingRef.current || !selectedImage?.id) return;
      const pt = clientToSource(e.clientX, e.clientY);
      if (!pt) return;

      if (eraserTool === "brush") {
        brushPointsRef.current.push(pt);
        const mask = getOrCreateMask();
        if (mask) {
          paintBrushStroke(mask, [pt], brushSize);
          dispatch({
            type: "SET_EDIT_STATE",
            id: selectedImage.id,
            editState: { ...selectedImage.editState!, eraseMask: mask },
          });
        }
      } else {
        lassoPointsRef.current.push(pt);
        // Draw lasso path on overlay canvas
        drawLassoOverlay();
      }
    },
    [eraserTool, brushSize, selectedImage, clientToSource, getOrCreateMask, dispatch],
  );

  const handleEraserMouseUp = useCallback(() => {
    if (!erasingRef.current || !selectedImage?.id) return;
    erasingRef.current = false;

    if (eraserTool === "lasso") {
      const points = lassoPointsRef.current;
      if (points.length >= 3) {
        const mask = getOrCreateMask();
        if (mask) {
          fillLassoRegion(mask, points);
          dispatch({
            type: "SET_EDIT_STATE",
            id: selectedImage.id,
            editState: { ...selectedImage.editState!, eraseMask: mask },
          });
        }
      }
      lassoPointsRef.current = [];
      // Clear overlay
      const overlay = overlayRef.current;
      if (overlay) {
        const ctx = overlay.getContext("2d");
        if (ctx) ctx.clearRect(0, 0, overlay.width, overlay.height);
      }
    }
    brushPointsRef.current = [];
  }, [eraserTool, selectedImage, getOrCreateMask, dispatch]);
```

- [ ] **Step 5: Add lasso overlay drawing**

Add a function to draw the lasso path during dragging:

```typescript
  const drawLassoOverlay = useCallback(() => {
    const overlay = overlayRef.current;
    const canvas = canvasRef.current;
    const info = scaleInfoRef.current;
    if (!overlay || !canvas || !info) return;

    const rect = canvas.getBoundingClientRect();
    overlay.width = rect.width;
    overlay.height = rect.height;
    overlay.style.width = `${rect.width}px`;
    overlay.style.height = `${rect.height}px`;

    const ctx = overlay.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, overlay.width, overlay.height);

    const points = lassoPointsRef.current;
    if (points.length < 2) return;

    ctx.strokeStyle = "rgba(255, 100, 100, 0.8)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(
      (points[0][0] / info.srcW) * rect.width,
      (points[0][1] / info.srcH) * rect.height,
    );
    for (let i = 1; i < points.length; i++) {
      ctx.lineTo(
        (points[i][0] / info.srcW) * rect.width,
        (points[i][1] / info.srcH) * rect.height,
      );
    }
    ctx.stroke();
  }, []);
```

- [ ] **Step 6: Update draw() to apply eraseMask**

In the existing `draw()` callback, after the `drawProgressive` call, add eraseMask application. Update the draw function body — add after line `drawProgressive(ctx, rotated, canvas.width, canvas.height);`:

```typescript
    // Apply eraseMask overlay
    const eraseMask = selectedImage?.editState?.eraseMask;
    if (eraseMask && filterType !== "none" && filteredCanvas) {
      const applied = applyEraseMask(rotated instanceof HTMLCanvasElement ? rotated : displayCanvas, eraseMask);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      drawProgressive(ctx, applied, canvas.width, canvas.height);
      sourceRef.current = applied;
    }
```

Add `selectedImage?.editState?.eraseMask` to the dependency array of `draw`:

```typescript
  ], [
    selectedImage?.cropCanvas,
    selectedImage?.filteredCanvas,
    selectedImage?.editState?.rotation,
    selectedImage?.editState?.filterConfig?.type,
    selectedImage?.originalCanvas,
    selectedImage?.editState?.eraseMask,
  ]);
```

- [ ] **Step 7: Update mouse handlers to switch between loupe and eraser modes**

Update `handleMouseMove` and add the eraser events to the JSX. Replace the existing `handleMouseMove`:

```typescript
  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (eraserActive) {
        handleEraserMouseMove(e);
        return;
      }
      if (!loupeVisible) setLoupeVisible(true);
      drawLoupe(e.clientX, e.clientY);
    },
    [eraserActive, handleEraserMouseMove, loupeVisible, drawLoupe],
  );

  const handleMouseLeave = useCallback(() => {
    setLoupeVisible(false);
    if (erasingRef.current) {
      handleEraserMouseUp();
    }
  }, [handleEraserMouseUp]);
```

- [ ] **Step 8: Update the JSX to include eraser events and overlay canvas**

Update the container div to add mouseDown/mouseUp handlers and the overlay canvas. Replace the return JSX:

```tsx
  return (
    <div
      ref={containerRef}
      className="flex-1 flex items-center justify-center p-4 bg-[var(--bg-secondary)] overflow-hidden relative"
      onMouseMove={handleMouseMove}
      onMouseDown={eraserActive ? handleEraserMouseDown : undefined}
      onMouseUp={eraserActive ? handleEraserMouseUp : undefined}
      onMouseLeave={handleMouseLeave}
      style={{ cursor: eraserActive ? (eraserTool === "brush" ? "crosshair" : "crosshair") : undefined }}
    >
      <canvas ref={canvasRef} />
      {/* Lasso overlay */}
      <canvas
        ref={overlayRef}
        className="pointer-events-none absolute"
        style={{
          left: canvasRef.current?.offsetLeft,
          top: canvasRef.current?.offsetTop,
          opacity: eraserActive && eraserTool === "lasso" ? 1 : 0,
        }}
      />
      {/* Loupe (hidden when eraser is active) */}
      <canvas
        ref={loupeRef}
        className="pointer-events-none absolute rounded-full shadow-lg"
        style={{
          width: LOUPE_CSS,
          height: LOUPE_CSS,
          opacity: loupeVisible && !eraserActive ? 1 : 0,
          transition: "opacity 150ms",
          border: "2px solid rgba(255,255,255,0.15)",
          background: "#111",
        }}
      />
    </div>
  );
```

- [ ] **Step 9: Verify build**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 10: Commit**

```bash
git add src/components/CropPreview.tsx
git commit -m "feat: add eraser brush and lasso interaction to CropPreview"
```

---

### Task 5: Export Integration — Apply EraseMask Before Export

**Files:**
- Modify: `src/components/TopBar.tsx`
- Modify: `src/lib/pdfExport.ts`

- [ ] **Step 1: Update TopBar export handlers to apply eraseMask**

In `src/components/TopBar.tsx`, add the import at the top:
```typescript
import { applyEraseMask } from "../lib/eraser";
```

Update `handleExport` (single JPEG export). After determining `sourceCanvas` (line ~38), add eraseMask application:

Replace lines 34-38:
```typescript
    const filterType = selectedImage.editState?.filterConfig?.type ?? "none";
    const sourceCanvas =
      filterType !== "none" && selectedImage.filteredCanvas
        ? selectedImage.filteredCanvas
        : selectedImage.cropCanvas;
```
with:
```typescript
    const filterType = selectedImage.editState?.filterConfig?.type ?? "none";
    let sourceCanvas =
      filterType !== "none" && selectedImage.filteredCanvas
        ? selectedImage.filteredCanvas
        : selectedImage.cropCanvas;

    // Apply erase mask if present
    const eraseMask = selectedImage.editState?.eraseMask;
    if (eraseMask && sourceCanvas && filterType !== "none") {
      sourceCanvas = applyEraseMask(sourceCanvas, eraseMask);
    }
```

Update `handleExportAll` (ZIP export). Inside the `for` loop, after determining `sourceCanvas` (around line ~66), add:

Replace lines 62-66:
```typescript
        const filterType = img.editState?.filterConfig?.type ?? "none";
        const sourceCanvas =
          filterType !== "none" && img.filteredCanvas
            ? img.filteredCanvas
            : img.cropCanvas;
```
with:
```typescript
        const filterType = img.editState?.filterConfig?.type ?? "none";
        let sourceCanvas =
          filterType !== "none" && img.filteredCanvas
            ? img.filteredCanvas
            : img.cropCanvas;

        const eraseMask = img.editState?.eraseMask;
        if (eraseMask && sourceCanvas && filterType !== "none") {
          sourceCanvas = applyEraseMask(sourceCanvas, eraseMask);
        }
```

- [ ] **Step 2: Update PDF export to apply eraseMask**

In `src/lib/pdfExport.ts`, add the import at the top:
```typescript
import { applyEraseMask } from "./eraser";
```

In the `exportPdf` function, inside the `for` loop (around line 149), after `const rotated = rotateCanvas(cropCanvas, editState.rotation);`, add eraseMask application for the binarize path. The binarize path currently sends raw RGBA to the worker for worker-side binarization. Since the worker does its own binarization, the eraseMask needs to be applied AFTER binarization. 

However, the current architecture sends raw crop pixels to the worker which does binarization itself. To apply the eraseMask, we need to either:
1. Send the eraseMask to the worker, or
2. Pre-binarize on the main thread and send the erased result as JPEG

The simplest approach: when an eraseMask exists, use the already-binarized `filteredCanvas` (which exists on the ImageEntry), apply the eraseMask, and send as JPEG instead of raw RGBA. This avoids changing the worker protocol.

Update the binarize branch in the for loop. Replace lines 149-165:
```typescript
    if (editState.filterConfig.type === "binarize") {
      // Binarize path: send raw RGBA pixels to worker
      const rgbaBytes = canvasToRgbaBytes(rotated);
      const { blockRadiusBps, contrastOffset, upsamplingScale } =
        editState.filterConfig.binarize;

      pages.push({
        type: "binarize",
        rgbaBytes,
        width,
        height,
        blockRadiusBps,
        contrastOffset,
        upsamplingScale,
      });
      transferables.push(rgbaBytes);
```
with:
```typescript
    if (editState.filterConfig.type === "binarize") {
      const eraseMask = editState.eraseMask;

      if (eraseMask && img.filteredCanvas) {
        // Has erase mask: apply it to the pre-binarized filteredCanvas, send as JPEG
        const erased = applyEraseMask(img.filteredCanvas, eraseMask);
        const erasedRotated = rotateCanvas(erased, editState.rotation);
        const jpegBytes = await canvasToJpegBytes(erasedRotated, 0.95);
        pages.push({
          type: "jpeg",
          jpegBytes,
          width: erasedRotated.width,
          height: erasedRotated.height,
        });
        transferables.push(jpegBytes);
      } else {
        // No erase mask: send raw RGBA for worker-side binarization
        const rgbaBytes = canvasToRgbaBytes(rotated);
        const { blockRadiusBps, contrastOffset, upsamplingScale } =
          editState.filterConfig.binarize;

        pages.push({
          type: "binarize",
          rgbaBytes,
          width,
          height,
          blockRadiusBps,
          contrastOffset,
          upsamplingScale,
        });
        transferables.push(rgbaBytes);
      }
```

- [ ] **Step 3: Verify build**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 4: Verify full build**

Run: `npm run build`
Expected: Build succeeds.

- [ ] **Step 5: Commit**

```bash
git add src/components/TopBar.tsx src/lib/pdfExport.ts
git commit -m "feat: apply eraseMask in JPEG, ZIP, and PDF export paths"
```

---

## Self-Review

**1. Spec coverage:**
- ✅ EraseMask data model with Uint8Array → Task 1
- ✅ Auto-clear on binarize param change → Task 2 (SET_EDIT_STATE)
- ✅ Auto-clear on batch filter → Task 2 (BATCH_SET_FILTER)
- ✅ Brush tool with configurable radius → Task 4
- ✅ Lasso tool with polygon fill → Task 4
- ✅ Eraser toggle in ToolPanel → Task 3
- ✅ Brush/Lasso selector → Task 3
- ✅ Brush size slider → Task 3
- ✅ Clear Eraser button → Task 3
- ✅ Undo/redo integration via cloneEditState → Task 2
- ✅ CropPreview rendering with eraseMask → Task 4
- ✅ JPEG/ZIP export with eraseMask → Task 5
- ✅ PDF export with eraseMask → Task 5
- ✅ Exit eraser on image switch → Task 3
- ✅ Exit eraser on Escape → Task 3
- ✅ editStateFromQuad sets eraseMask: null → Task 2

**2. Placeholder scan:** No TBD/TODO/placeholder language found.

**3. Type consistency:**
- `EraseMask` used consistently: defined in types.ts, imported in eraser.ts, AppContext, CropPreview, TopBar, pdfExport
- `cloneEraseMask` defined in eraser.ts, used in AppContext
- `createEraseMask` defined in eraser.ts, used in CropPreview
- `applyEraseMask` defined in eraser.ts, used in CropPreview, TopBar, pdfExport
- `paintBrushStroke` defined in eraser.ts, used in CropPreview
- `fillLassoRegion` defined in eraser.ts, used in CropPreview
- Eraser props (`eraserActive`, `eraserTool`, `brushSize`) consistent between EditorScreen, ToolPanel, CropPreview
