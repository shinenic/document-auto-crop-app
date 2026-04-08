# Guide Lines Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add freely draggable horizontal guide lines to CropPreview for verifying staff line alignment in sheet music scans.

**Architecture:** State lives in AppContext (`showGuides`, `globalGuideLines` on AppState; `localGuideLines` on ImageEntry). Guide line rendering and interaction logic live in a new `GuideLineOverlay` component rendered inside CropPreview's container. Controls are embedded in the Preview header bar in EditorScreen. Toggle button in TopBar mirrors the existing Mask pattern.

**Tech Stack:** React 19, Next.js 16 (static export), TypeScript, Canvas 2D API, Tailwind CSS

---

### Task 1: State Model — Types and Reducer

**Files:**
- Modify: `src/lib/types.ts:73-101`
- Modify: `src/context/AppContext.tsx:22-40,273-299`

- [ ] **Step 1: Add state fields to types.ts**

In `src/lib/types.ts`, add `localGuideLines` to `ImageEntry` (after `error` at line 87):

```typescript
// In ImageEntry interface, add after error?: string;
  localGuideLines: number[] | null; // null = use global; number[] = local Y positions (0–1)
```

Add `showGuides` and `globalGuideLines` to `AppState` (after `showMask` at line 100):

```typescript
// In AppState interface, add after showMask: boolean;
  showGuides: boolean;
  globalGuideLines: number[];
```

- [ ] **Step 2: Add action types to AppContext.tsx**

In `src/context/AppContext.tsx`, add three new actions to the `AppAction` union (after line 39):

```typescript
  | { type: "TOGGLE_GUIDES" }
  | { type: "SET_GLOBAL_GUIDES"; lines: number[] }
  | { type: "SET_LOCAL_GUIDES"; imageId: string; lines: number[] | null }
```

- [ ] **Step 3: Add reducer cases**

In `src/context/AppContext.tsx`, add reducer cases before the `default` case (before line 285):

```typescript
    case "TOGGLE_GUIDES":
      return { ...state, showGuides: !state.showGuides };

    case "SET_GLOBAL_GUIDES":
      return { ...state, globalGuideLines: action.lines };

    case "SET_LOCAL_GUIDES":
      return {
        ...state,
        images: state.images.map((img) =>
          img.id === action.imageId
            ? { ...img, localGuideLines: action.lines }
            : img,
        ),
      };
```

- [ ] **Step 4: Update initial state defaults**

In `src/context/AppContext.tsx`, add defaults to `initialState` (after `showMask: true` at line 298):

```typescript
  showGuides: false,
  globalGuideLines: [],
```

- [ ] **Step 5: Update LOAD_DRAFT action type and reducer**

Update the `LOAD_DRAFT` action type to include guide state:

```typescript
  | { type: "LOAD_DRAFT"; images: ImageEntry[]; showMask: boolean; showGuides: boolean; globalGuideLines: number[] }
```

Update the `LOAD_DRAFT` reducer case to restore guide state:

```typescript
    case "LOAD_DRAFT":
      return {
        ...state,
        screen: "editor",
        images: action.images,
        selectedImageId: action.images[0]?.id ?? null,
        showMask: action.showMask,
        showGuides: action.showGuides,
        globalGuideLines: action.globalGuideLines,
      };
```

- [ ] **Step 6: Fix all places that create ImageEntry objects**

Search for all places that construct `ImageEntry` objects and add `localGuideLines: null`. Key locations:

In `src/components/imageProcessor.ts`, where new `ImageEntry` objects are created, add:
```typescript
localGuideLines: null,
```

In `src/lib/draft.ts`, in `loadDraft()` where `images.push({...})` (around line 296), add:
```typescript
localGuideLines: null,
```

- [ ] **Step 7: Verify build**

Run: `npm run build`
Expected: Build succeeds with no type errors related to guide lines.

- [ ] **Step 8: Commit**

```bash
git add src/lib/types.ts src/context/AppContext.tsx src/components/imageProcessor.ts src/lib/draft.ts
git commit -m "feat(guides): add state model for guide lines"
```

---

### Task 2: TopBar Toggle and View Menu

**Files:**
- Modify: `src/components/TopBar.tsx:599-603,650-661`

- [ ] **Step 1: Add Guides toggle button in TopBar**

In `src/components/TopBar.tsx`, add a `Guides` button right after the `Mask` button (after line 661):

```tsx
{/* Guide lines toggle */}
<button
  className={`px-2 py-1 text-[10px] rounded transition-colors ${
    state.showGuides
      ? "bg-[var(--accent-muted)] text-[var(--accent)]"
      : "text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
  }`}
  onClick={() => dispatch({ type: "TOGGLE_GUIDES" })}
  title="Toggle guide lines (G)"
>
  Guides
</button>
```

- [ ] **Step 2: Add View menu item**

In `src/components/TopBar.tsx`, add a menu item in the View dropdown after the "Show Mask Overlay" item (after line 603):

```tsx
<MenuItem
  label="Show Guide Lines"
  onClick={() => dispatch({ type: "TOGGLE_GUIDES" })}
  checked={state.showGuides}
  shortcut="G"
/>
```

- [ ] **Step 3: Verify visually**

Run: `npm run dev`
Check: TopBar shows a "Guides" button next to "Mask". Clicking toggles the accent styling. View menu shows "Show Guide Lines" with checkmark when active.

- [ ] **Step 4: Commit**

```bash
git add src/components/TopBar.tsx
git commit -m "feat(guides): add TopBar toggle button and View menu item"
```

---

### Task 3: Keyboard Shortcut

**Files:**
- Modify: `src/components/EditorScreen.tsx:45-94,404-408`

- [ ] **Step 1: Add G keyboard shortcut**

In `src/components/EditorScreen.tsx`, add a handler for the `G` key in the `handleKey` function. Insert after the `Escape` handler block (after line 62) and before the eraser `e` key handler (line 64):

```typescript
      if (e.key.toLowerCase() === "g" && !eraserActive) {
        e.preventDefault();
        dispatch({ type: "TOGGLE_GUIDES" });
        return;
      }
```

- [ ] **Step 2: Add to keyboard shortcuts overlay**

In `src/components/EditorScreen.tsx`, add a "View" group to the shortcuts list (after the "Editing" group around line 407):

```typescript
{ group: "View", keys: [["G", "Toggle guide lines"]] },
```

- [ ] **Step 3: Verify**

Run: `npm run dev`
Check: Press `G` toggles guide lines on/off. `?` overlay shows the shortcut.

- [ ] **Step 4: Commit**

```bash
git add src/components/EditorScreen.tsx
git commit -m "feat(guides): add G keyboard shortcut"
```

---

### Task 4: Preview Header Controls

**Files:**
- Modify: `src/components/EditorScreen.tsx:369-374`

- [ ] **Step 1: Add guide line control state**

In `src/components/EditorScreen.tsx`, the Preview header needs to show controls when `state.showGuides` is true. The selected image determines whether we're in Global or Local mode.

Replace the Preview header section (lines 369-374) with:

```tsx
          <div className="flex-1 flex flex-col min-w-0">
            <div className="px-3 py-1.5 border-b border-[var(--border)] bg-[var(--bg-secondary)] flex items-center justify-between">
              <h4 className="text-[11px] uppercase tracking-[0.06em] text-[var(--text-muted)] font-semibold">
                Preview
              </h4>
              {state.showGuides && (
                <div className="flex items-center gap-1.5">
                  <button
                    className="px-1.5 py-0.5 text-[9px] rounded bg-[var(--bg-tertiary)] text-[var(--text-muted)] hover:text-[var(--text-secondary)] border border-[var(--border)] transition-colors"
                    onClick={() => {
                      const img = getSelectedImage(state);
                      const isLocal = img?.localGuideLines != null;
                      const lines = isLocal
                        ? img!.localGuideLines!
                        : state.globalGuideLines;
                      const newLines = [...lines, 0.5];
                      if (isLocal && img) {
                        dispatch({ type: "SET_LOCAL_GUIDES", imageId: img.id, lines: newLines });
                      } else {
                        dispatch({ type: "SET_GLOBAL_GUIDES", lines: newLines });
                      }
                    }}
                    title="Add guide line"
                  >
                    + Add
                  </button>
                  <span className="text-[9px] font-mono text-[var(--accent)] min-w-[1ch] text-center">
                    {(() => {
                      const img = getSelectedImage(state);
                      const lines = img?.localGuideLines ?? state.globalGuideLines;
                      return lines.length;
                    })()}
                  </span>
                  {/* G/L scope toggle */}
                  <div className="flex rounded border border-[var(--border)] overflow-hidden">
                    <button
                      className={`px-1.5 py-0.5 text-[9px] transition-colors ${
                        !(getSelectedImage(state)?.localGuideLines != null)
                          ? "bg-[var(--accent-muted)] text-[var(--accent)]"
                          : "text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
                      }`}
                      onClick={() => {
                        const img = getSelectedImage(state);
                        if (img?.localGuideLines != null) {
                          dispatch({ type: "SET_LOCAL_GUIDES", imageId: img.id, lines: null });
                        }
                      }}
                      title="Global — shared across all images"
                    >
                      G
                    </button>
                    <button
                      className={`px-1.5 py-0.5 text-[9px] transition-colors ${
                        getSelectedImage(state)?.localGuideLines != null
                          ? "bg-[var(--accent-muted)] text-[var(--accent)]"
                          : "text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
                      }`}
                      onClick={() => {
                        const img = getSelectedImage(state);
                        if (img && img.localGuideLines == null) {
                          dispatch({
                            type: "SET_LOCAL_GUIDES",
                            imageId: img.id,
                            lines: [...state.globalGuideLines],
                          });
                        }
                      }}
                      title="Local — independent for this image"
                    >
                      L
                    </button>
                  </div>
                  <button
                    className="px-1.5 py-0.5 text-[9px] rounded text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors"
                    onClick={() => {
                      const img = getSelectedImage(state);
                      const isLocal = img?.localGuideLines != null;
                      if (isLocal && img) {
                        dispatch({ type: "SET_LOCAL_GUIDES", imageId: img.id, lines: [] });
                      } else {
                        dispatch({ type: "SET_GLOBAL_GUIDES", lines: [] });
                      }
                    }}
                    title="Clear all guide lines"
                  >
                    Clear
                  </button>
                </div>
              )}
            </div>
```

- [ ] **Step 2: Verify visually**

Run: `npm run dev`
Check: When Guides is on, Preview header shows `+ Add`, count, G/L toggle, and Clear. Clicking `+ Add` increments the count. G/L toggle switches modes. Clear resets count to 0.

- [ ] **Step 3: Commit**

```bash
git add src/components/EditorScreen.tsx
git commit -m "feat(guides): add Preview header controls for guide lines"
```

---

### Task 5: Guide Line Rendering on CropPreview

**Files:**
- Modify: `src/components/CropPreview.tsx`

- [ ] **Step 1: Add guide line rendering to the draw function**

In `src/components/CropPreview.tsx`, after the `drawProgressive` call (line 272), add guide line rendering. First, read guide line state from context. The component already has `const { state, dispatch } = useApp();`.

After the existing `drawProgressive(ctx, rotated, canvas.width, canvas.height);` line, add:

```typescript
  // Draw guide lines
  if (state.showGuides) {
    const img = state.images.find((i) => i.id === state.selectedImageId);
    const lines = img?.localGuideLines ?? state.globalGuideLines;
    if (lines.length > 0) {
      ctx.save();
      ctx.lineWidth = dpr; // 1 CSS pixel
      for (const pct of lines) {
        const y = Math.round(pct * canvas.height);
        ctx.strokeStyle = "rgba(92, 224, 194, 0.5)";
        ctx.shadowColor = "rgba(92, 224, 194, 0.3)";
        ctx.shadowBlur = 3 * dpr;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(canvas.width, y);
        ctx.stroke();
      }
      ctx.restore();
    }
  }
```

- [ ] **Step 2: Add guide state to draw dependency array**

Add `state.showGuides`, `state.globalGuideLines`, and the selected image's `localGuideLines` to the `draw` useCallback dependency array.

The existing deps (around line 274) are:
```typescript
], [
  selectedImage?.cropCanvas,
  selectedImage?.filteredCanvas,
  selectedImage?.editState?.rotation,
  selectedImage?.editState?.filterConfig?.type,
  selectedImage?.editState?.eraseMask,
  selectedImage?.originalCanvas,
]);
```

Add these to the dependency array:
```typescript
  state.showGuides,
  state.globalGuideLines,
  selectedImage?.localGuideLines,
```

- [ ] **Step 3: Verify visually**

Run: `npm run dev`
Check: Turn on Guides, add a few lines via the `+ Add` button. Teal horizontal lines appear on the crop preview at 50% height. Each new line stacks at 50%.

- [ ] **Step 4: Commit**

```bash
git add src/components/CropPreview.tsx
git commit -m "feat(guides): render guide lines on CropPreview canvas"
```

---

### Task 6: Guide Line Drag Interaction

**Files:**
- Modify: `src/components/CropPreview.tsx`

This task adds drag-to-move, click-to-add, and drag-out-to-delete interactions for guide lines on the CropPreview canvas.

- [ ] **Step 1: Add guide line interaction refs and state**

At the top of the `CropPreview` component (near the other refs around lines 25-40), add:

```typescript
  // Guide line interaction state
  const guideDragRef = useRef<{ index: number; isLocal: boolean } | null>(null);
```

- [ ] **Step 2: Add helper to get guide line at a Y position**

Add a helper function inside the component to detect if a Y coordinate is near a guide line. This needs access to `scaleInfoRef` and the canvas:

```typescript
  const getGuideLineAtY = useCallback(
    (clientY: number): number | null => {
      const canvas = canvasRef.current;
      if (!canvas) return null;
      const rect = canvas.getBoundingClientRect();
      const relY = (clientY - rect.top) / rect.height;
      const img = state.images.find((i) => i.id === state.selectedImageId);
      const lines = img?.localGuideLines ?? state.globalGuideLines;
      const hitThreshold = 8 / rect.height; // 8 CSS pixels tolerance
      for (let i = 0; i < lines.length; i++) {
        if (Math.abs(lines[i] - relY) < hitThreshold) return i;
      }
      return null;
    },
    [state.images, state.selectedImageId, state.globalGuideLines],
  );
```

- [ ] **Step 3: Add pointer event handlers for guide lines**

Add handlers for pointer down/move/up that handle guide line interactions. These run when guides are active AND eraser is NOT active:

```typescript
  const handleGuidePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (!state.showGuides || eraserActive) return;
      const hitIdx = getGuideLineAtY(e.clientY);
      if (hitIdx != null) {
        e.preventDefault();
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
        const img = state.images.find((i) => i.id === state.selectedImageId);
        guideDragRef.current = {
          index: hitIdx,
          isLocal: img?.localGuideLines != null,
        };
      }
    },
    [state.showGuides, eraserActive, getGuideLineAtY, state.images, state.selectedImageId],
  );

  const handleGuidePointerMove = useCallback(
    (e: React.PointerEvent) => {
      // Update cursor when hovering near a guide line
      if (state.showGuides && !eraserActive && !guideDragRef.current) {
        const hitIdx = getGuideLineAtY(e.clientY);
        const container = containerRef.current;
        if (container) {
          container.style.cursor = hitIdx != null ? "ns-resize" : "";
        }
      }

      if (!guideDragRef.current) return;
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const relY = (e.clientY - rect.top) / rect.height;
      const { index, isLocal } = guideDragRef.current;
      const img = state.images.find((i) => i.id === state.selectedImageId);
      const lines = [...(isLocal ? img!.localGuideLines! : state.globalGuideLines)];
      lines[index] = Math.max(0, Math.min(1, relY));
      if (isLocal && img) {
        dispatch({ type: "SET_LOCAL_GUIDES", imageId: img.id, lines });
      } else {
        dispatch({ type: "SET_GLOBAL_GUIDES", lines });
      }
    },
    [state.showGuides, eraserActive, getGuideLineAtY, state.images, state.selectedImageId, state.globalGuideLines, dispatch],
  );

  const handleGuidePointerUp = useCallback(
    (e: React.PointerEvent) => {
      if (!guideDragRef.current) {
        // Click-to-add: if guides active, eraser inactive, and no drag happened
        if (state.showGuides && !eraserActive) {
          const canvas = canvasRef.current;
          if (!canvas) return;
          const rect = canvas.getBoundingClientRect();
          const relY = (e.clientY - rect.top) / rect.height;
          if (relY < 0 || relY > 1) return;
          // Only add if not clicking on an existing line
          const hitIdx = getGuideLineAtY(e.clientY);
          if (hitIdx != null) return;
          const img = state.images.find((i) => i.id === state.selectedImageId);
          const isLocal = img?.localGuideLines != null;
          const lines = [...(isLocal ? img!.localGuideLines! : state.globalGuideLines)];
          lines.push(relY);
          if (isLocal && img) {
            dispatch({ type: "SET_LOCAL_GUIDES", imageId: img.id, lines });
          } else {
            dispatch({ type: "SET_GLOBAL_GUIDES", lines });
          }
        }
        return;
      }

      // Drag end — remove if dragged outside canvas
      const canvas = canvasRef.current;
      if (canvas) {
        const rect = canvas.getBoundingClientRect();
        const relY = (e.clientY - rect.top) / rect.height;
        if (relY < -0.02 || relY > 1.02) {
          // Dragged out — remove this line
          const { index, isLocal } = guideDragRef.current;
          const img = state.images.find((i) => i.id === state.selectedImageId);
          const lines = [...(isLocal ? img!.localGuideLines! : state.globalGuideLines)];
          lines.splice(index, 1);
          if (isLocal && img) {
            dispatch({ type: "SET_LOCAL_GUIDES", imageId: img.id, lines });
          } else {
            dispatch({ type: "SET_GLOBAL_GUIDES", lines });
          }
        }
      }
      guideDragRef.current = null;
    },
    [state.showGuides, eraserActive, getGuideLineAtY, state.images, state.selectedImageId, state.globalGuideLines, dispatch],
  );
```

- [ ] **Step 4: Wire up pointer events on the container**

In the container div's JSX (around line 478), the existing events are:
```tsx
onPointerMove={handlePointerMove}
onPointerDown={eraserActive ? handleEraserPointerDown : undefined}
onPointerUp={eraserActive ? handleEraserPointerUp : undefined}
onPointerLeave={handlePointerLeave}
```

Replace with combined handlers:
```tsx
onPointerMove={(e) => {
  handlePointerMove(e);
  handleGuidePointerMove(e);
}}
onPointerDown={(e) => {
  if (eraserActive) {
    handleEraserPointerDown(e);
  } else {
    handleGuidePointerDown(e);
  }
}}
onPointerUp={(e) => {
  if (eraserActive) {
    handleEraserPointerUp();
  }
  handleGuidePointerUp(e);
}}
onPointerLeave={handlePointerLeave}
```

- [ ] **Step 5: Add Delete/Backspace key handler for removing guide lines**

This requires knowing which line is "selected". Since lines are simple and clicking one starts a drag, we'll handle deletion via a keydown listener in the component. Add a `selectedGuideRef` to track the last-clicked guide:

Actually, a simpler approach: the user can just drag lines out of the canvas to delete. The `Delete` key behavior can be added by tracking the most-recently-dragged line index. Add to the component:

```typescript
  // Handle Delete key to remove the last-interacted guide line
  useEffect(() => {
    if (!state.showGuides) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Delete" || e.key === "Backspace") {
        const tag = (e.target as HTMLElement)?.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA") return;
        // Remove the last guide line added (most recently interacted)
        const img = state.images.find((i) => i.id === state.selectedImageId);
        const isLocal = img?.localGuideLines != null;
        const lines = [...(isLocal ? img!.localGuideLines! : state.globalGuideLines)];
        if (lines.length === 0) return;
        e.preventDefault();
        lines.pop();
        if (isLocal && img) {
          dispatch({ type: "SET_LOCAL_GUIDES", imageId: img.id, lines });
        } else {
          dispatch({ type: "SET_GLOBAL_GUIDES", lines });
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [state.showGuides, state.images, state.selectedImageId, state.globalGuideLines, dispatch]);
```

- [ ] **Step 6: Verify interaction**

Run: `npm run dev`
Check:
1. Click on canvas to add guide lines at clicked Y position
2. Hover over a line — cursor changes to `ns-resize`
3. Drag a line vertically — it follows the mouse
4. Drag a line out of the canvas — it gets deleted
5. Press Delete — removes the last line
6. When eraser is active, clicking adds brush strokes, not guide lines

- [ ] **Step 7: Commit**

```bash
git add src/components/CropPreview.tsx
git commit -m "feat(guides): add drag, click-to-add, and delete interactions"
```

---

### Task 7: Draft Persistence

**Files:**
- Modify: `src/lib/draft.ts:5-36,135-206,244-315`
- Modify: `src/context/DraftContext.tsx:104-145,194`

- [ ] **Step 1: Update manifest types in draft.ts**

In `src/lib/draft.ts`, add `localGuideLines` to `ManifestImage` (after `history` at line 15):

```typescript
  localGuideLines: number[] | null;
```

Add `showGuides` and `globalGuideLines` to `Manifest` (after `showMask` at line 29):

```typescript
  showGuides: boolean;
  globalGuideLines: number[];
```

Add `showGuides` and `globalGuideLines` to `DraftData` (after `showMask` at line 34):

```typescript
  showGuides: boolean;
  globalGuideLines: number[];
```

- [ ] **Step 2: Update saveDraft function**

Update the `saveDraft` function signature (line 135) to accept the new params:

```typescript
export async function saveDraft(
  dirHandle: FileSystemDirectoryHandle,
  images: ImageEntry[],
  showMask: boolean,
  showGuides: boolean,
  globalGuideLines: number[],
  dirtyIds: Set<string> | null,
): Promise<void> {
```

In the `manifestImages.push({...})` call (around line 180), add:

```typescript
      localGuideLines: img.localGuideLines,
```

In the manifest object (around line 195), add after `showMask`:

```typescript
    showGuides,
    globalGuideLines,
```

- [ ] **Step 3: Update loadDraft function**

In the `loadDraft` function, in the `images.push({...})` call (around line 296), add:

```typescript
      localGuideLines: mImg.localGuideLines ?? null,
```

Update the return statement (line 314):

```typescript
  return {
    showMask: manifest.showMask,
    showGuides: manifest.showGuides ?? false,
    globalGuideLines: manifest.globalGuideLines ?? [],
    images,
  };
```

- [ ] **Step 4: Update DraftContext.tsx**

In `src/context/DraftContext.tsx`, update the `doSave` call to pass guide state. Find where `saveDraft` is called (around line 109) and add the new params:

```typescript
    await saveDraft(handle, s.images, s.showMask, s.showGuides, s.globalGuideLines, dirtyIds);
```

Update the auto-save effect dependency array (around line 145) to include guide state:

```typescript
  }, [state.images, state.showMask, state.showGuides, state.globalGuideLines, state.screen, doSave]);
```

Update the `LOAD_DRAFT` dispatch (around line 194) to include guide data:

```typescript
    dispatch({
      type: "LOAD_DRAFT",
      images: data.images,
      showMask: data.showMask,
      showGuides: data.showGuides,
      globalGuideLines: data.globalGuideLines,
    });
```

- [ ] **Step 5: Verify persistence**

Run: `npm run dev`
Check:
1. Add guide lines, save draft
2. Reload and open draft — guide lines are restored
3. Global and local guide lines both persist correctly

- [ ] **Step 6: Commit**

```bash
git add src/lib/draft.ts src/context/DraftContext.tsx
git commit -m "feat(guides): persist guide lines in draft save/restore"
```

---

### Task 8: Final Verification and Lint

**Files:** None new

- [ ] **Step 1: Run lint**

Run: `npm run lint`
Expected: No new lint errors.

- [ ] **Step 2: Run build**

Run: `npm run build`
Expected: Build succeeds.

- [ ] **Step 3: Manual integration test**

Run: `npm run dev`
Verify the full workflow:
1. Toggle guides on via TopBar button, View menu, and `G` key
2. `+ Add` button adds a line at center
3. Click on canvas adds a line at clicked position
4. Drag lines vertically
5. Drag out of canvas or press Delete removes lines
6. Switch to Global/Local mode via G/L toggle
7. Switch images — global lines persist, local lines are per-image
8. Eraser mode: clicks do not add guide lines
9. Save/load draft preserves all guide lines
10. Guide lines render on rotated images correctly

- [ ] **Step 4: Final commit (if any remaining changes)**

```bash
git add -A
git commit -m "feat(guides): final cleanup"
```
