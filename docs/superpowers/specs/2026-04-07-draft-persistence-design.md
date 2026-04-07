# Draft Persistence & Menu Bar Redesign

## Overview

Add draft save/restore functionality using the File System Access API (`showDirectoryPicker`), with auto-save after the first manual save. Restructure the TopBar from individual buttons to a standard File/Edit/View menu bar.

## Constraints

- File System Access API only (Chrome/Edge). No fallback for Safari/Firefox — show a hint.
- Directory-based storage: one folder contains images + manifest.
- Auto-save via 2-second debounce after first manual save.
- Architecture: separate persistence layer (hook + utility module), not integrated into AppContext.

## Draft Folder Format

```
my-draft-folder/
├── manifest.json
├── original-001.jpg       # JPEG 95% quality
├── original-002.jpg
├── mask-001.bin            # Raw Uint8Array 256×256
├── mask-002.bin
├── erasemask-002.bin       # Only for images with eraser data
└── ...
```

### manifest.json

```json
{
  "version": 1,
  "savedAt": "2026-04-07T10:30:00Z",
  "showMaskOverlay": true,
  "images": [
    {
      "id": "abc123",
      "fileName": "scan-page1.jpg",
      "originalFile": "original-001.jpg",
      "maskFile": "mask-001.bin",
      "maskWidth": 256,
      "maskHeight": 256,
      "eraseMaskFile": null,
      "initialQuad": { "corners": [...], "edges": [...], "edgeFits": [...] },
      "editState": {
        "corners": [[x,y], ...],
        "edgeFits": [...],
        "rotation": 0,
        "filterConfig": { "type": "none", "binarize": {...} },
        "eraseMaskFile": "erasemask-001.bin"
      },
      "history": { "past": [...], "future": [...] }
    }
  ]
}
```

### Design decisions

- Original images saved as JPEG 95% — sheet music scans are photos, JPEG saves space.
- Masks stored as raw binary (256×256 = 65KB) for fast read/write.
- EraseMask in separate files — large (crop resolution), most images won't have one.
- History stored in manifest — EditState entries are small JSON objects, 50-entry cap is fine.
- cropCanvas / filteredCanvas NOT stored — derived from originalCanvas + editState on load.

## Persistence Layer: `lib/draft.ts`

Pure-function module, no React dependency.

### Write functions

- `saveDraft(dirHandle, appState)` — main entry
  - Converts each image's `originalCanvas` to JPEG blob → writes `original-{index}.jpg`
  - Writes `mask` Uint8Array → `mask-{index}.bin`
  - Writes `eraseMask` (if present) → `erasemask-{index}.bin`
  - Assembles and writes manifest.json
  - **Incremental**: only writes files for dirty images (original + mask only on first save per image; manifest always rewritten)

- `deleteStaleFiles(dirHandle, currentFileNames)` — removes files for deleted images

### Read functions

- `loadDraft(dirHandle): Promise<DraftData>` — main entry
  - Reads manifest.json
  - For each image: reads JPEG → creates `HTMLCanvasElement` (originalCanvas), reads mask binary → Uint8Array, reads eraseMask if present
  - Returns fully reconstructed `ImageEntry[]`

- `loadManifestOnly(dirHandle): Promise<ManifestInfo>` — lightweight read for preview display on UploadScreen

### Types

```typescript
interface DraftData {
  showMaskOverlay: boolean;
  images: ImageEntry[];
}

interface ManifestInfo {
  version: number;
  savedAt: string;
  imageCount: number;
  fileNames: string[];
}
```

## Hook & Context: `hooks/useDraftPersistence.ts` + `context/DraftContext.tsx`

### DraftContext interface

```typescript
interface DraftContextValue {
  dirHandle: FileSystemDirectoryHandle | null;
  isSaving: boolean;
  lastSavedAt: string | null;
  hasUnsavedChanges: boolean;
  save: () => Promise<void>;
  saveAs: () => Promise<void>;
  openDraft: () => Promise<void>;
  openRecentDraft: () => Promise<void>;
}
```

### Hook internals

1. **Directory Handle management**: stored in `useRef`, mirrored to context state. On successful handle acquisition, persisted to IndexedDB (raw IndexedDB wrapper, no external deps) under key `"lastDraftHandle"`.

2. **Auto-save (debounce 2s)**: `useEffect` watches `appState`. On change, resets a 2-second timer. On expiry, calls `saveDraft()`. Guards: skip if no `dirHandle`; skip if `isSaving` is true.

3. **hasUnsavedChanges**: tracked via incrementing `changeCounter` ref. Each state change increments; each successful save records the counter value. `hasUnsavedChanges = current !== lastSaved`.

4. **Load flow**: `openDraft()` calls `showDirectoryPicker()` → `loadDraft()` → dispatches `LOAD_DRAFT`. `openRecentDraft()` retrieves handle from IndexedDB → `requestPermission({mode:'readwrite'})` → same load flow.

### New AppContext reducer action

```typescript
{ type: "LOAD_DRAFT", images: ImageEntry[], showMaskOverlay: boolean }
```

Replaces entire `images` array and `showMaskOverlay`. Sets `screen: "editor"`, `selectedImageId` to first image.

### Provider nesting (page.tsx)

```tsx
<AppProvider>
  <DraftProvider>
    <AppContent />
  </DraftProvider>
</AppProvider>
```

## TopBar Menu Bar Restructure

### Layout

- Left: App title → **File** / **Edit** / **View** menu triggers
- Right: image count + draft status indicator + BG swatches
- Removes: `+ Add`, `Manage`, `Batch`, `Export` standalone buttons

### File menu

| Item | Shortcut | Condition |
|---|---|---|
| Open Draft Folder... | ⌘O | Always |
| Save Draft | ⌘S | Has images |
| Save Draft As... | ⇧⌘S | Has images |
| --- | | |
| Add Images... | | Always |
| Manage Images | | Has images |
| --- | | |
| **Export** (label) | | |
| Download Current as JPEG | ⌘E | Selected + cropCanvas |
| Download All as ZIP | | readyCount > 0 |
| Export as PDF... | | readyCount > 0 |

### Edit menu

| Item | Shortcut | Condition |
|---|---|---|
| Undo | ⌘Z | Has past history |
| Redo | ⇧⌘Z | Has future history |
| --- | | |
| Rotate 90° CW | R | Has editState |
| Rotate 90° CCW | ⇧R | Has editState |
| Reset to Detection | | Has editState |
| Cancel Crop | | Has editState |
| --- | | |
| **Batch** (label) | | 2+ images with editState |
| Rotate All CW | | |
| Rotate All CCW | | |
| Apply Filter to All... | | Opens sub-panel (same filter UI as current Batch dropdown) |

### View menu

| Item | Shortcut | Condition |
|---|---|---|
| Preview Background ▸ | | Sub-menu: Checker / Black / Gray / White |
| Show Mask Overlay | | Toggle (maps to `showMaskOverlay`) |
| --- | | |
| Previous Image | ↑ | |
| Next Image | ↓ | |
| --- | | |
| Keyboard Shortcuts | ? | |

### Keyboard shortcut changes

- `⌘S`: was Export JPEG → now Save Draft
- `⌘E`: new, maps to Export JPEG
- All other shortcuts unchanged; `useKeyboardShortcuts` updated accordingly

### Draft status indicator (right side of TopBar)

- Saving: small spinner + "Saving..."
- Saved: muted text "Saved 10:30"
- Unsaved changes: small dot indicator

## UploadScreen Changes

### Layout addition

Below the existing drop zone:

```
── or ──

[Open Recent Draft]
"5 images · saved Apr 7, 10:30"

[Open Draft Folder...]
```

### Logic

- On mount: read `lastDraftHandle` from IndexedDB
  - If handle exists → call `handle.queryPermission({ mode: 'readwrite' })`
    - If 'granted' (same session, e.g. user navigated back to upload screen) → `loadManifestOnly(handle)` to show summary (image count, saved time)
    - If 'prompt' (typical after page reload) → show "Open Recent Draft" button with generic label (no summary, since we can't read without permission)
  - If no handle in IndexedDB → show only "Open Draft Folder..."

### Open Recent Draft click flow

1. `handle.requestPermission({ mode: 'readwrite' })` — browser prompts
2. Granted → `loadDraft(handle)` → dispatch `LOAD_DRAFT` → switch to editor
3. Denied → show message "Folder access required to restore draft"

### Open Draft Folder click flow

1. `showDirectoryPicker()` → user picks folder
2. `loadDraft(handle)` → dispatch `LOAD_DRAFT` → switch to editor
3. Save handle to IndexedDB

### Browser support detection

- Check `'showDirectoryPicker' in window` on mount
- Not supported → hide both buttons, show small hint: "Draft save/restore requires Chrome or Edge"

## Rebuild on Load

After `LOAD_DRAFT` dispatches, images have `originalCanvas`, `mask`, `editState` but `cropCanvas = null`. The existing EditorScreen pipeline already handles this case — when `editState` exists but `cropCanvas` is null, it triggers crop recalculation automatically. No additional rebuild logic needed.

## Files to Create/Modify

### New files
- `src/lib/draft.ts` — serialization/deserialization + file system operations
- `src/lib/idb.ts` — minimal IndexedDB wrapper (get/set/delete for handle storage)
- `src/context/DraftContext.tsx` — DraftProvider + useDraft hook
- `src/hooks/useDraftPersistence.ts` — auto-save logic, handle management

### Modified files
- `src/components/TopBar.tsx` — complete restructure to menu bar
- `src/components/UploadScreen.tsx` — add Open Recent Draft / Open Draft Folder
- `src/context/AppContext.tsx` — add `LOAD_DRAFT` action
- `src/hooks/useKeyboardShortcuts.ts` — ⌘S → save draft, add ⌘E for export
- `src/app/page.tsx` — wrap with DraftProvider
