# Draft Persistence & Menu Bar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add draft save/restore to local filesystem via File System Access API, with auto-save after first manual save, and restructure TopBar into a standard File/Edit/View menu bar.

**Architecture:** Persistence layer as separate modules (`lib/idb.ts`, `lib/draft.ts`) + React integration via `DraftContext`. TopBar restructured from standalone buttons to dropdown menus. UploadScreen gains draft restore entry points.

**Tech Stack:** File System Access API (`showDirectoryPicker`), IndexedDB (raw, no deps), React Context, existing Next.js 16 + TypeScript + Tailwind stack.

**Spec:** `docs/superpowers/specs/2026-04-07-draft-persistence-design.md`

**Note:** No test framework is configured. Each task includes manual verification steps instead of automated tests.

---

## File Structure

### New files
| File | Responsibility |
|---|---|
| `src/lib/idb.ts` | Minimal IndexedDB wrapper: get/set/delete for storing `FileSystemDirectoryHandle` |
| `src/lib/draft.ts` | Pure-function module: serialize/deserialize app state to/from a directory via File System Access API |
| `src/context/DraftContext.tsx` | React context providing save/open/saveAs actions + auto-save hook + draft status |

### Modified files
| File | Changes |
|---|---|
| `src/lib/types.ts` | Make `ImageEntry.file` optional (`File \| null`) since draft-loaded images have no original File |
| `src/context/AppContext.tsx` | Add `LOAD_DRAFT` reducer action |
| `src/app/page.tsx` | Wrap `AppContent` with `DraftProvider` |
| `src/components/TopBar.tsx` | Complete restructure: button-style → File/Edit/View menu bar + draft status indicator |
| `src/components/UploadScreen.tsx` | Add "Open Recent Draft" and "Open Draft Folder..." buttons |
| `src/hooks/useKeyboardShortcuts.ts` | `⌘S` → save draft, add `⌘E` → export JPEG, add `⌘O` → open draft |
| `src/components/EditorScreen.tsx` | Update keyboard shortcuts overlay text |

---

### Task 1: IndexedDB Wrapper

**Files:**
- Create: `src/lib/idb.ts`

- [ ] **Step 1: Create `src/lib/idb.ts`**

```typescript
const DB_NAME = "document-auto-crop";
const DB_VERSION = 1;
const STORE_NAME = "kv";

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE_NAME);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function idbGet<T>(key: string): Promise<T | undefined> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const req = tx.objectStore(STORE_NAME).get(key);
    req.onsuccess = () => resolve(req.result as T | undefined);
    req.onerror = () => reject(req.error);
    tx.oncomplete = () => db.close();
  });
}

export async function idbSet<T>(key: string, value: T): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(value, key);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

export async function idbDelete(key: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).delete(key);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}
```

- [ ] **Step 2: Verify** — open the app in Chrome DevTools, run in console:
```js
// Should complete without errors (after importing at runtime or pasting equivalent)
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/idb.ts
git commit -m "feat: add minimal IndexedDB wrapper for draft handle storage"
```

---

### Task 2: Update Types — Make `ImageEntry.file` Optional

**Files:**
- Modify: `src/lib/types.ts:74`

When loading images from a draft, we won't have the original `File` object. We need to make this field nullable.

- [ ] **Step 1: Check all usages of `ImageEntry.file`**

Search the codebase for `.file` accesses on ImageEntry to identify what needs null handling. Key usages:
- `imageProcessor.ts` — sets `file` during initial load (no change needed, still passes real File)
- `TopBar.tsx` — not used
- `EditorScreen.tsx` — not used
- Other components — likely not used after initial processing

- [ ] **Step 2: Update type in `src/lib/types.ts`**

Change line 74:
```typescript
// Before:
  file: File;
// After:
  file: File | null;
```

- [ ] **Step 3: Fix any TypeScript errors caused by the change**

In `src/components/imageProcessor.ts`, the `file` property is set from the input `File` — this already satisfies `File | null`. Check `npm run build` for any other errors and fix them.

- [ ] **Step 4: Verify** — `npm run build` passes with no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/lib/types.ts
# Also add any files with null-handling fixes
git commit -m "refactor: make ImageEntry.file nullable for draft-loaded images"
```

---

### Task 3: Add `LOAD_DRAFT` Action to AppContext

**Files:**
- Modify: `src/context/AppContext.tsx`

- [ ] **Step 1: Add the action type to the `AppAction` union**

In `src/context/AppContext.tsx`, add to the `AppAction` type union (after the `TOGGLE_MASK` line):

```typescript
  | { type: "LOAD_DRAFT"; images: ImageEntry[]; showMask: boolean };
```

- [ ] **Step 2: Add the reducer case**

Add before the `default:` case in the reducer:

```typescript
    case "LOAD_DRAFT":
      return {
        ...state,
        screen: "editor",
        images: action.images,
        selectedImageId: action.images[0]?.id ?? null,
        showMask: action.showMask,
      };
```

- [ ] **Step 3: Add `ImageEntry` to the import from types if not already imported**

Check the imports at the top — `ImageEntry` is already imported via the type imports. No change needed.

- [ ] **Step 4: Verify** — `npm run build` passes.

- [ ] **Step 5: Commit**

```bash
git add src/context/AppContext.tsx
git commit -m "feat: add LOAD_DRAFT reducer action for draft restoration"
```

---

### Task 4: Draft Serialization Module

**Files:**
- Create: `src/lib/draft.ts`

This is the largest task. The module handles reading/writing the draft directory.

- [ ] **Step 1: Create `src/lib/draft.ts` with types and helper functions**

```typescript
import type { ImageEntry, EditState, EdgeFit, EraseMask, QuadResult, ImageHistory } from "./types";
import { DEFAULT_FILTER_CONFIG } from "./types";

// --- Types ---

export interface ManifestImage {
  id: string;
  fileName: string;
  originalFile: string;
  maskFile: string | null;
  maskWidth: number;
  maskHeight: number;
  eraseMaskFile: string | null;
  initialQuad: QuadResult | null;
  editState: ManifestEditState | null;
  history: { past: ManifestEditState[]; future: ManifestEditState[] };
}

/** EditState as serialized in manifest — eraseMask replaced by file reference */
interface ManifestEditState {
  corners: [number, number][];
  edgeFits: EdgeFit[];
  rotation: 0 | 90 | 180 | 270;
  filterConfig: { type: "none" | "binarize"; binarize: { blockRadiusBps: number; contrastOffset: number; upsamplingScale: number } };
  eraseMaskFile: string | null;
}

interface Manifest {
  version: number;
  savedAt: string;
  showMask: boolean;
  images: ManifestImage[];
}

export interface DraftData {
  showMask: boolean;
  images: ImageEntry[];
}

export interface ManifestInfo {
  version: number;
  savedAt: string;
  imageCount: number;
  fileNames: string[];
}

// --- Helpers ---

function editStateToManifest(es: EditState, eraseMaskFile: string | null): ManifestEditState {
  return {
    corners: es.corners.map(c => [...c] as [number, number]),
    edgeFits: es.edgeFits.map(f => ({ cp1: [...f.cp1] as [number, number], cp2: [...f.cp2] as [number, number], isArc: f.isArc })),
    rotation: es.rotation,
    filterConfig: { type: es.filterConfig.type, binarize: { ...es.filterConfig.binarize } },
    eraseMaskFile,
  };
}

function manifestToEditState(m: ManifestEditState, eraseMask: EraseMask | null): EditState {
  return {
    corners: m.corners.map(c => [...c] as [number, number]),
    edgeFits: m.edgeFits.map(f => ({ cp1: [...f.cp1] as [number, number], cp2: [...f.cp2] as [number, number], isArc: f.isArc })),
    rotation: m.rotation,
    filterConfig: { type: m.filterConfig.type, binarize: { ...m.filterConfig.binarize } },
    eraseMask,
  };
}

function historyToManifest(h: ImageHistory): { past: ManifestEditState[]; future: ManifestEditState[] } {
  return {
    past: h.past.map(es => editStateToManifest(es, null)),
    future: h.future.map(es => editStateToManifest(es, null)),
  };
}

function manifestToHistory(m: { past: ManifestEditState[]; future: ManifestEditState[] }): ImageHistory {
  return {
    past: m.past.map(es => manifestToEditState(es, null)),
    future: m.future.map(es => manifestToEditState(es, null)),
  };
}

async function canvasToBlob(canvas: HTMLCanvasElement, type = "image/jpeg", quality = 0.95): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      blob => blob ? resolve(blob) : reject(new Error("canvas.toBlob returned null")),
      type,
      quality,
    );
  });
}

async function blobToCanvas(blob: Blob): Promise<HTMLCanvasElement> {
  const img = new Image();
  const url = URL.createObjectURL(blob);
  try {
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("Failed to load image from blob"));
      img.src = url;
    });
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(img, 0, 0);
    return canvas;
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function writeFile(dirHandle: FileSystemDirectoryHandle, name: string, data: Blob | BufferSource) {
  const fileHandle = await dirHandle.getFileHandle(name, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(data);
  await writable.close();
}

async function readFile(dirHandle: FileSystemDirectoryHandle, name: string): Promise<ArrayBuffer> {
  const fileHandle = await dirHandle.getFileHandle(name);
  const file = await fileHandle.getFile();
  return file.arrayBuffer();
}

async function fileExists(dirHandle: FileSystemDirectoryHandle, name: string): Promise<boolean> {
  try {
    await dirHandle.getFileHandle(name);
    return true;
  } catch {
    return false;
  }
}
```

- [ ] **Step 2: Add `saveDraft` function**

Append to `src/lib/draft.ts`:

```typescript
// --- Write ---

export async function saveDraft(
  dirHandle: FileSystemDirectoryHandle,
  images: ImageEntry[],
  showMask: boolean,
  dirtyIds: Set<string> | null, // null = save all (first save)
): Promise<void> {
  const manifestImages: ManifestImage[] = [];
  const usedFileNames = new Set<string>();

  for (let i = 0; i < images.length; i++) {
    const img = images[i];
    const idx = String(i + 1).padStart(3, "0");
    const originalFile = `original-${idx}.jpg`;
    const maskFile = img.mask ? `mask-${idx}.bin` : null;

    let eraseMaskFile: string | null = null;
    const activeEraseMask = img.editState?.eraseMask ?? null;

    usedFileNames.add(originalFile);
    if (maskFile) usedFileNames.add(maskFile);

    // Write original image (only if dirty or first save)
    if (dirtyIds === null || dirtyIds.has(img.id)) {
      if (img.originalCanvas) {
        const blob = await canvasToBlob(img.originalCanvas);
        await writeFile(dirHandle, originalFile, blob);
      }

      // Write mask
      if (img.mask && maskFile) {
        await writeFile(dirHandle, maskFile, img.mask.buffer);
      }
    }

    // Write eraseMask (always rewrite if present, since it changes with edits)
    if (activeEraseMask) {
      eraseMaskFile = `erasemask-${idx}.bin`;
      usedFileNames.add(eraseMaskFile);
      // Store dimensions as 4-byte header: [width_u16, height_u16] + data
      const header = new Uint16Array([activeEraseMask.width, activeEraseMask.height]);
      const combined = new Uint8Array(4 + activeEraseMask.data.length);
      combined.set(new Uint8Array(header.buffer), 0);
      combined.set(activeEraseMask.data, 4);
      await writeFile(dirHandle, eraseMaskFile, combined.buffer);
    }

    manifestImages.push({
      id: img.id,
      fileName: img.fileName,
      originalFile,
      maskFile,
      maskWidth: img.maskWidth,
      maskHeight: img.maskHeight,
      eraseMaskFile,
      initialQuad: img.initialQuad,
      editState: img.editState ? editStateToManifest(img.editState, eraseMaskFile) : null,
      history: historyToManifest(img.history),
    });
  }

  // Write manifest
  const manifest: Manifest = {
    version: 1,
    savedAt: new Date().toISOString(),
    showMask,
    images: manifestImages,
  };
  const manifestBlob = new Blob([JSON.stringify(manifest, null, 2)], { type: "application/json" });
  await writeFile(dirHandle, "manifest.json", manifestBlob);

  // Clean up stale files
  await deleteStaleFiles(dirHandle, usedFileNames);
}

async function deleteStaleFiles(dirHandle: FileSystemDirectoryHandle, keepNames: Set<string>): Promise<void> {
  keepNames.add("manifest.json");
  const toDelete: string[] = [];
  for await (const [name] of dirHandle.entries()) {
    if (!keepNames.has(name)) {
      toDelete.push(name);
    }
  }
  for (const name of toDelete) {
    try {
      await dirHandle.removeEntry(name);
    } catch {
      // Ignore errors removing stale files
    }
  }
}
```

- [ ] **Step 3: Add `loadDraft` and `loadManifestOnly` functions**

Append to `src/lib/draft.ts`:

```typescript
// --- Read ---

export async function loadManifestOnly(dirHandle: FileSystemDirectoryHandle): Promise<ManifestInfo | null> {
  try {
    const buf = await readFile(dirHandle, "manifest.json");
    const manifest: Manifest = JSON.parse(new TextDecoder().decode(buf));
    return {
      version: manifest.version,
      savedAt: manifest.savedAt,
      imageCount: manifest.images.length,
      fileNames: manifest.images.map(img => img.fileName),
    };
  } catch {
    return null;
  }
}

export async function loadDraft(dirHandle: FileSystemDirectoryHandle): Promise<DraftData> {
  const buf = await readFile(dirHandle, "manifest.json");
  const manifest: Manifest = JSON.parse(new TextDecoder().decode(buf));

  const images: ImageEntry[] = [];

  for (const mImg of manifest.images) {
    // Load original image → canvas
    let originalCanvas: HTMLCanvasElement | null = null;
    try {
      const imgBuf = await readFile(dirHandle, mImg.originalFile);
      originalCanvas = await blobToCanvas(new Blob([imgBuf], { type: "image/jpeg" }));
    } catch (e) {
      console.error(`Failed to load ${mImg.originalFile}:`, e);
    }

    // Load mask
    let mask: Uint8Array | null = null;
    if (mImg.maskFile) {
      try {
        const maskBuf = await readFile(dirHandle, mImg.maskFile);
        mask = new Uint8Array(maskBuf);
      } catch (e) {
        console.error(`Failed to load ${mImg.maskFile}:`, e);
      }
    }

    // Load eraseMask from editState reference
    let eraseMask: EraseMask | null = null;
    const eraseMaskFile = mImg.editState?.eraseMaskFile ?? null;
    if (eraseMaskFile && await fileExists(dirHandle, eraseMaskFile)) {
      try {
        const emBuf = await readFile(dirHandle, eraseMaskFile);
        const arr = new Uint8Array(emBuf);
        const header = new Uint16Array(arr.buffer, 0, 2);
        const width = header[0];
        const height = header[1];
        const data = arr.slice(4);
        eraseMask = { width, height, data };
      } catch (e) {
        console.error(`Failed to load ${eraseMaskFile}:`, e);
      }
    }

    // Rebuild editState
    const editState = mImg.editState
      ? manifestToEditState(mImg.editState, eraseMask)
      : null;

    // Rebuild history (eraseMasks in history are not persisted as files — they're null)
    const history = manifestToHistory(mImg.history);

    images.push({
      id: mImg.id,
      file: null,
      fileName: mImg.fileName,
      originalCanvas,
      mask,
      maskWidth: mImg.maskWidth,
      maskHeight: mImg.maskHeight,
      initialQuad: mImg.initialQuad,
      editState,
      history,
      cropCanvas: null,       // Will be recomputed by EditorScreen pipeline
      filteredCanvas: null,    // Will be recomputed by EditorScreen pipeline
      status: originalCanvas ? "ready" : "error",
      error: originalCanvas ? undefined : "Failed to load image from draft",
    });
  }

  return { showMask: manifest.showMask, images };
}
```

- [ ] **Step 4: Verify** — `npm run build` passes.

- [ ] **Step 5: Commit**

```bash
git add src/lib/draft.ts
git commit -m "feat: add draft serialization module for directory-based persistence"
```

---

### Task 5: DraftContext + Auto-Save Hook

**Files:**
- Create: `src/context/DraftContext.tsx`
- Modify: `src/app/page.tsx`

- [ ] **Step 1: Create `src/context/DraftContext.tsx`**

```typescript
"use client";

import {
  createContext,
  useContext,
  useCallback,
  useRef,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { useApp } from "./AppContext";
import { saveDraft, loadDraft, loadManifestOnly } from "../lib/draft";
import { idbGet, idbSet, idbDelete } from "../lib/idb";
import type { ManifestInfo } from "../lib/draft";

const IDB_HANDLE_KEY = "lastDraftHandle";

export interface DraftContextValue {
  dirHandle: FileSystemDirectoryHandle | null;
  isSaving: boolean;
  lastSavedAt: string | null;
  hasUnsavedChanges: boolean;
  save: () => Promise<void>;
  saveAs: () => Promise<void>;
  openDraft: () => Promise<void>;
  openRecentDraft: () => Promise<void>;
  recentDraftInfo: ManifestInfo | null;
  isSupported: boolean;
}

const DraftContext = createContext<DraftContextValue>({
  dirHandle: null,
  isSaving: false,
  lastSavedAt: null,
  hasUnsavedChanges: false,
  save: async () => {},
  saveAs: async () => {},
  openDraft: async () => {},
  openRecentDraft: async () => {},
  recentDraftInfo: null,
  isSupported: false,
});

export function useDraft() {
  return useContext(DraftContext);
}

export function DraftProvider({ children }: { children: ReactNode }) {
  const { state, dispatch } = useApp();
  const [dirHandle, setDirHandle] = useState<FileSystemDirectoryHandle | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const [recentDraftInfo, setRecentDraftInfo] = useState<ManifestInfo | null>(null);

  const dirHandleRef = useRef(dirHandle);
  dirHandleRef.current = dirHandle;

  const isSavingRef = useRef(false);
  const changeCounter = useRef(0);
  const savedCounter = useRef(0);
  const savedImageIdsRef = useRef<Set<string>>(new Set());
  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isSupported = typeof window !== "undefined" && "showDirectoryPicker" in window;

  // Track state changes for hasUnsavedChanges
  const stateRef = useRef(state);
  stateRef.current = state;

  const hasUnsavedChanges = dirHandle !== null && changeCounter.current !== savedCounter.current;

  // Check for recent draft handle on mount
  useEffect(() => {
    if (!isSupported) return;
    (async () => {
      try {
        const handle = await idbGet<FileSystemDirectoryHandle>(IDB_HANDLE_KEY);
        if (!handle) return;

        // Check if we already have permission (same session)
        const perm = await handle.queryPermission({ mode: "readwrite" });
        if (perm === "granted") {
          const info = await loadManifestOnly(handle);
          if (info) {
            setRecentDraftInfo(info);
          } else {
            await idbDelete(IDB_HANDLE_KEY);
          }
        } else {
          // Can't read without permission, but handle exists — show generic button
          setRecentDraftInfo({ version: 0, savedAt: "", imageCount: 0, fileNames: [] });
        }
      } catch {
        // Silently ignore — handle may be stale
      }
    })();
  }, [isSupported]);

  // Perform the actual save
  const doSave = useCallback(async (handle: FileSystemDirectoryHandle) => {
    if (isSavingRef.current) return;
    isSavingRef.current = true;
    setIsSaving(true);
    try {
      const s = stateRef.current;
      // Determine dirty images (images not yet saved to this directory)
      const dirtyIds = savedImageIdsRef.current.size === 0
        ? null // First save — write everything
        : new Set(s.images.filter(img => !savedImageIdsRef.current.has(img.id)).map(img => img.id));

      await saveDraft(handle, s.images, s.showMask, dirtyIds);

      // Update tracking
      savedCounter.current = changeCounter.current;
      savedImageIdsRef.current = new Set(s.images.map(img => img.id));
      setLastSavedAt(new Date().toISOString());
    } catch (e) {
      console.error("Draft save failed:", e);
    } finally {
      isSavingRef.current = false;
      setIsSaving(false);
    }
  }, []);

  // Auto-save: debounce 2s after state changes
  useEffect(() => {
    if (!dirHandleRef.current) return;
    if (state.screen !== "editor") return;
    if (state.images.length === 0) return;

    changeCounter.current++;

    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    autoSaveTimer.current = setTimeout(() => {
      if (dirHandleRef.current) {
        doSave(dirHandleRef.current);
      }
    }, 2000);

    return () => {
      if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    };
  }, [state.images, state.showMask, doSave]);

  // Save: use existing handle or prompt for new one
  const save = useCallback(async () => {
    if (!isSupported) return;
    let handle = dirHandleRef.current;
    if (!handle) {
      try {
        handle = await window.showDirectoryPicker({ mode: "readwrite" });
      } catch {
        return; // User cancelled
      }
      setDirHandle(handle);
      dirHandleRef.current = handle;
      await idbSet(IDB_HANDLE_KEY, handle);
    }
    await doSave(handle);
  }, [isSupported, doSave]);

  // Save As: always prompt for new directory
  const saveAs = useCallback(async () => {
    if (!isSupported) return;
    let handle: FileSystemDirectoryHandle;
    try {
      handle = await window.showDirectoryPicker({ mode: "readwrite" });
    } catch {
      return; // User cancelled
    }
    setDirHandle(handle);
    dirHandleRef.current = handle;
    savedImageIdsRef.current = new Set(); // Force full re-save
    await idbSet(IDB_HANDLE_KEY, handle);
    await doSave(handle);
  }, [isSupported, doSave]);

  // Open draft from picker
  const openDraft = useCallback(async () => {
    if (!isSupported) return;
    let handle: FileSystemDirectoryHandle;
    try {
      handle = await window.showDirectoryPicker({ mode: "readwrite" });
    } catch {
      return; // User cancelled
    }
    const data = await loadDraft(handle);
    setDirHandle(handle);
    dirHandleRef.current = handle;
    savedImageIdsRef.current = new Set(data.images.map(img => img.id));
    savedCounter.current = changeCounter.current;
    await idbSet(IDB_HANDLE_KEY, handle);
    setLastSavedAt(new Date().toISOString());
    dispatch({ type: "LOAD_DRAFT", images: data.images, showMask: data.showMask });
  }, [isSupported, dispatch]);

  // Open recent draft from IndexedDB handle
  const openRecentDraft = useCallback(async () => {
    if (!isSupported) return;
    const handle = await idbGet<FileSystemDirectoryHandle>(IDB_HANDLE_KEY);
    if (!handle) return;

    // Request permission
    const perm = await handle.requestPermission({ mode: "readwrite" });
    if (perm !== "granted") return;

    const data = await loadDraft(handle);
    setDirHandle(handle);
    dirHandleRef.current = handle;
    savedImageIdsRef.current = new Set(data.images.map(img => img.id));
    savedCounter.current = changeCounter.current;
    setLastSavedAt(new Date().toISOString());
    dispatch({ type: "LOAD_DRAFT", images: data.images, showMask: data.showMask });
  }, [isSupported, dispatch]);

  return (
    <DraftContext.Provider value={{
      dirHandle,
      isSaving,
      lastSavedAt,
      hasUnsavedChanges,
      save,
      saveAs,
      openDraft,
      openRecentDraft,
      recentDraftInfo,
      isSupported,
    }}>
      {children}
    </DraftContext.Provider>
  );
}
```

- [ ] **Step 2: Update `src/app/page.tsx` to wrap with DraftProvider**

Replace the entire file:

```typescript
"use client";

import { AppProvider, useApp } from "../context/AppContext";
import { DraftProvider } from "../context/DraftContext";
import UploadScreen from "../components/UploadScreen";
import EditorScreen from "../components/EditorScreen";

function AppContent() {
  const { state } = useApp();

  if (state.screen === "upload") {
    return <UploadScreen />;
  }

  return <EditorScreen />;
}

export default function Home() {
  return (
    <AppProvider>
      <DraftProvider>
        <AppContent />
      </DraftProvider>
    </AppProvider>
  );
}
```

- [ ] **Step 3: Verify** — `npm run build` passes. Open the app in Chrome, check DevTools console for no errors.

- [ ] **Step 4: Commit**

```bash
git add src/context/DraftContext.tsx src/app/page.tsx
git commit -m "feat: add DraftContext with auto-save and directory handle management"
```

---

### Task 6: TopBar Menu Bar Restructure

**Files:**
- Modify: `src/components/TopBar.tsx`

This is the largest UI task. The TopBar transforms from standalone buttons to a File/Edit/View menu bar.

- [ ] **Step 1: Rewrite `src/components/TopBar.tsx`**

Keep the existing `DropdownMenu`, `MenuItem`, `MenuDivider`, `MenuLabel` components (they already work well). Restructure the main `TopBar` component.

Key changes to the `TopBar` component:
- **Props**: Add callbacks for Edit menu actions (`onUndo`, `onRedo`, `onRotateCW`, `onRotateCCW`, `onResetPrediction`, `onCancelCrop`, `onToggleShortcuts`, `onNavigate`). These are needed because the TopBar doesn't own the editing state — EditorScreen does.
- **Left side**: App title, then File / Edit / View dropdown triggers
- **Right side**: Image count, draft status indicator, BG swatches
- **File menu**: Open Draft, Save Draft, Save As, separator, Add Images, Manage Images, separator, Export section
- **Edit menu**: Undo/Redo, separator, Rotate CW/CCW, Reset/Cancel, separator, Batch section
- **View menu**: Preview BG sub-items, Show Mask toggle, separator, Prev/Next Image, separator, Keyboard Shortcuts

The full replacement code for `TopBar.tsx`:

Replace the **TopBar component** (the export default function and everything below it, keeping the DropdownMenu/MenuItem/MenuDivider/MenuLabel components unchanged). The new TopBar component should:

1. Import `useDraft` from `../context/DraftContext`
2. Add these new props to the component signature:
```typescript
export default function TopBar({
  onManageImages,
  previewBg,
  onSetPreviewBg,
  onUndo,
  onRedo,
  onRotateCW,
  onRotateCCW,
  onResetPrediction,
  onCancelCrop,
  onToggleShortcuts,
  onNavigate,
}: {
  onManageImages?: () => void;
  previewBg?: PreviewBg;
  onSetPreviewBg?: (bg: PreviewBg) => void;
  onUndo?: () => void;
  onRedo?: () => void;
  onRotateCW?: () => void;
  onRotateCCW?: () => void;
  onResetPrediction?: () => void;
  onCancelCrop?: () => void;
  onToggleShortcuts?: () => void;
  onNavigate?: (dir: "up" | "down") => void;
})
```

3. Inside the component, get draft context: `const draft = useDraft();`

4. Left side layout:
```tsx
<div className="flex items-center gap-0">
  <span className="text-sm font-semibold text-[var(--text-primary)] mr-4">
    Document Auto-Crop
  </span>
  {/* File Menu */}
  <DropdownMenu label="File" minWidth={260}>
    <MenuItem label="Open Draft Folder..." onClick={draft.openDraft} shortcut="⌘O" disabled={!draft.isSupported} />
    <MenuItem label="Save Draft" onClick={draft.save} shortcut="⌘S" disabled={state.images.length === 0 || !draft.isSupported} />
    <MenuItem label="Save Draft As..." onClick={draft.saveAs} shortcut="⇧⌘S" disabled={state.images.length === 0 || !draft.isSupported} />
    <MenuDivider />
    <MenuItem label="Add Images..." onClick={() => fileInputRef.current?.click()} />
    {onManageImages && <MenuItem label="Manage Images" onClick={onManageImages} disabled={state.images.length === 0} />}
    <MenuDivider />
    <MenuLabel>Export</MenuLabel>
    <MenuItem label="Download Current as JPEG" onClick={handleExport} disabled={!state.selectedImageId} shortcut="⌘E" />
    <MenuItem label={exporting ? "Exporting ZIP..." : `Download All as ZIP (${readyCount})`} onClick={handleExportAll} disabled={readyCount === 0 || exporting} />
    {/* PDF sub-section with page size picker — keep existing PDF UI */}
    <MenuDivider />
    <MenuLabel>PDF Export</MenuLabel>
    {/* ... existing PDF page size picker and export button ... */}
  </DropdownMenu>

  {/* Edit Menu */}
  <DropdownMenu label="Edit" minWidth={240}>
    <MenuItem label="Undo" onClick={onUndo} shortcut="⌘Z" disabled={!selectedImage || selectedImage.history.past.length === 0} />
    <MenuItem label="Redo" onClick={onRedo} shortcut="⇧⌘Z" disabled={!selectedImage || selectedImage.history.future.length === 0} />
    <MenuDivider />
    <MenuItem label="Rotate 90° CW" onClick={onRotateCW} shortcut="R" disabled={!selectedImage?.editState} />
    <MenuItem label="Rotate 90° CCW" onClick={onRotateCCW} shortcut="⇧R" disabled={!selectedImage?.editState} />
    <MenuItem label="Reset to Detection" onClick={onResetPrediction} disabled={!selectedImage?.editState} />
    <MenuItem label="Cancel Crop" onClick={onCancelCrop} disabled={!selectedImage?.editState} />
    {multipleImages && <>
      <MenuDivider />
      <MenuLabel>Batch</MenuLabel>
      <MenuItem label="Rotate All CW" onClick={handleBatchRotateCW} />
      <MenuItem label="Rotate All CCW" onClick={handleBatchRotateCCW} />
      {/* Batch filter sub-panel — keep existing filter toggle + sliders + apply button */}
    </>}
  </DropdownMenu>

  {/* View Menu */}
  <DropdownMenu label="View" minWidth={220}>
    <MenuLabel>Preview Background</MenuLabel>
    {onSetPreviewBg && (["checker", "black", "gray", "white"] as PreviewBg[]).map(bg => (
      <MenuItem key={bg} label={`${previewBg === bg ? "✓ " : "   "}${bg.charAt(0).toUpperCase() + bg.slice(1)}`} onClick={() => onSetPreviewBg(bg)} />
    ))}
    <MenuDivider />
    <MenuItem label={`${state.showMask ? "✓ " : "   "}Show Mask Overlay`} onClick={() => dispatch({ type: "TOGGLE_MASK" })} />
    <MenuDivider />
    <MenuItem label="Previous Image" onClick={() => onNavigate?.("up")} shortcut="↑" />
    <MenuItem label="Next Image" onClick={() => onNavigate?.("down")} shortcut="↓" />
    <MenuDivider />
    <MenuItem label="Keyboard Shortcuts" onClick={() => onToggleShortcuts?.()} shortcut="?" />
  </DropdownMenu>
</div>
```

5. Right side: image count + draft status + BG swatches:
```tsx
<div className="flex items-center gap-2">
  {/* Draft status indicator */}
  {draft.dirHandle && (
    <div className="flex items-center gap-1.5 text-[11px] text-[var(--text-muted)]">
      {draft.isSaving ? (
        <>
          <svg className="w-3 h-3 animate-spin" viewBox="0 0 16 16" fill="none">
            <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="2" strokeDasharray="28" strokeDashoffset="8" strokeLinecap="round" />
          </svg>
          <span>Saving...</span>
        </>
      ) : draft.lastSavedAt ? (
        <span>Saved {new Date(draft.lastSavedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
      ) : null}
      {draft.hasUnsavedChanges && !draft.isSaving && (
        <div className="w-1.5 h-1.5 rounded-full bg-[var(--accent)]" title="Unsaved changes" />
      )}
    </div>
  )}
  <span className="text-xs text-[var(--text-muted)]">
    {state.images.length} image{state.images.length !== 1 ? "s" : ""}
  </span>
  {/* BG swatches — keep existing */}
</div>
```

6. The menu trigger buttons should use a simpler style than the accent/non-accent DropdownMenu buttons. For menu triggers, use this class:
```
"px-2.5 py-1 text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] rounded transition-colors"
```
Modify the `DropdownMenu` component to accept a `menuTrigger` boolean prop that uses this simpler style instead of the default button style. When `menuTrigger` is true, also don't show the chevron arrow.

- [ ] **Step 2: Update `EditorScreen.tsx` to pass new TopBar props**

In `EditorScreen.tsx`, the `<TopBar>` call needs additional props. Add callbacks that dispatch to AppContext:

```tsx
<TopBar
  onManageImages={() => setSortModalOpen(true)}
  previewBg={previewBg}
  onSetPreviewBg={setPreviewBg}
  onUndo={() => { if (selectedImage) dispatch({ type: "UNDO", id: selectedImage.id }); }}
  onRedo={() => { if (selectedImage) dispatch({ type: "REDO", id: selectedImage.id }); }}
  onRotateCW={() => {
    if (selectedImage?.editState) {
      dispatch({ type: "PUSH_HISTORY", id: selectedImage.id });
      dispatch({ type: "SET_EDIT_STATE", id: selectedImage.id, editState: {
        ...selectedImage.editState,
        rotation: ((selectedImage.editState.rotation + 90) % 360) as 0 | 90 | 180 | 270,
      }});
    }
  }}
  onRotateCCW={() => {
    if (selectedImage?.editState) {
      dispatch({ type: "PUSH_HISTORY", id: selectedImage.id });
      dispatch({ type: "SET_EDIT_STATE", id: selectedImage.id, editState: {
        ...selectedImage.editState,
        rotation: ((selectedImage.editState.rotation + 270) % 360) as 0 | 90 | 180 | 270,
      }});
    }
  }}
  onResetPrediction={() => { if (selectedImage) dispatch({ type: "RESET_TO_PREDICTION", id: selectedImage.id }); }}
  onCancelCrop={() => { if (selectedImage) dispatch({ type: "CANCEL_CROP", id: selectedImage.id }); }}
  onToggleShortcuts={() => setShortcutsOpen(v => !v)}
  onNavigate={(dir) => {
    const idx = state.images.findIndex(img => img.id === state.selectedImageId);
    const newIdx = dir === "up" ? Math.max(0, idx - 1) : Math.min(state.images.length - 1, idx + 1);
    if (newIdx !== idx) dispatch({ type: "SELECT_IMAGE", id: state.images[newIdx].id });
  }}
/>
```

- [ ] **Step 3: Verify** — `npm run build` passes. Open the app, load some images, verify File/Edit/View menus render and items are clickable.

- [ ] **Step 4: Commit**

```bash
git add src/components/TopBar.tsx src/components/EditorScreen.tsx
git commit -m "feat: restructure TopBar into File/Edit/View menu bar with draft actions"
```

---

### Task 7: UploadScreen — Draft Restore Entry Points

**Files:**
- Modify: `src/components/UploadScreen.tsx`

- [ ] **Step 1: Update `UploadScreen.tsx`**

Add draft restore UI below the existing drop zone. Import `useDraft`:

```typescript
import { useDraft } from "../context/DraftContext";
```

Inside the component, add:

```typescript
const draft = useDraft();
```

After the format hints (`JPEG | PNG | WebP`) div and before the workflow hint div, add:

```tsx
{/* Draft restore section */}
{draft.isSupported && (
  <div className="mt-6 flex flex-col items-center gap-3" onClick={e => e.stopPropagation()}>
    <div className="flex items-center gap-3 text-[11px] text-[var(--text-muted)]">
      <div className="w-8 h-px bg-[var(--border)]" />
      <span>or</span>
      <div className="w-8 h-px bg-[var(--border)]" />
    </div>

    {draft.recentDraftInfo && (
      <button
        className="px-4 py-2 text-xs font-medium rounded-lg bg-[var(--bg-secondary)] border border-[var(--border)] text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] hover:border-[var(--border-hover)] transition-colors"
        onClick={draft.openRecentDraft}
      >
        Open Recent Draft
        {draft.recentDraftInfo.imageCount > 0 && (
          <span className="text-[var(--text-muted)] ml-2">
            {draft.recentDraftInfo.imageCount} images
            {draft.recentDraftInfo.savedAt && ` · saved ${new Date(draft.recentDraftInfo.savedAt).toLocaleDateString()}`}
          </span>
        )}
      </button>
    )}

    <button
      className="px-4 py-2 text-xs text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors"
      onClick={draft.openDraft}
    >
      Open Draft Folder...
    </button>
  </div>
)}

{!draft.isSupported && (
  <p className="mt-4 text-[10px] text-[var(--text-muted)]">
    Draft save/restore requires Chrome or Edge
  </p>
)}
```

Important: The draft buttons are inside the clickable upload area, so add `onClick={e => e.stopPropagation()}` on the wrapper to prevent triggering the file input.

- [ ] **Step 2: Verify** — Open the app, see "Open Draft Folder..." button on upload screen (and "Open Recent Draft" if a previous draft exists). Clicking buttons should trigger the directory picker, not the file input.

- [ ] **Step 3: Commit**

```bash
git add src/components/UploadScreen.tsx
git commit -m "feat: add draft restore buttons to UploadScreen"
```

---

### Task 8: Keyboard Shortcuts Update

**Files:**
- Modify: `src/hooks/useKeyboardShortcuts.ts`
- Modify: `src/components/EditorScreen.tsx` (shortcuts overlay text)

- [ ] **Step 1: Update `useKeyboardShortcuts.ts`**

The hook needs access to DraftContext. Update the signature and the Ctrl+S handler:

```typescript
import { useDraft } from "../context/DraftContext";
```

Inside the hook, add:

```typescript
const draft = useDraft();
```

Change the `⌘S` handler (lines 106-131) from export JPEG to save draft:

```typescript
// Save Draft: Ctrl+S
if (meta && !shift && e.key === "s") {
  e.preventDefault();
  draft.save();
  return;
}

// Save Draft As: Ctrl+Shift+S
if (meta && shift && (e.key === "s" || e.key === "S")) {
  e.preventDefault();
  draft.saveAs();
  return;
}

// Export JPEG: Ctrl+E
if (meta && !shift && e.key === "e") {
  e.preventDefault();
  if (selectedImage?.cropCanvas) {
    const filterType = selectedImage.editState?.filterConfig?.type ?? "none";
    let sourceCanvas =
      filterType !== "none" && selectedImage.filteredCanvas
        ? selectedImage.filteredCanvas
        : selectedImage.cropCanvas;
    const eraseMask = selectedImage.editState?.eraseMask;
    if (eraseMask && sourceCanvas && filterType !== "none") {
      sourceCanvas = applyEraseMask(sourceCanvas, eraseMask);
    }
    const rotation = selectedImage.editState?.rotation ?? 0;
    const final = rotateCanvas(sourceCanvas, rotation);
    final.toBlob((blob: Blob | null) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.download = `cropped-${selectedImage.fileName.replace(/\.[^.]+$/, "")}.jpg`;
      link.href = url;
      link.click();
      URL.revokeObjectURL(url);
    }, "image/jpeg", 0.92);
  }
  return;
}

// Open Draft: Ctrl+O
if (meta && !shift && e.key === "o") {
  e.preventDefault();
  draft.openDraft();
  return;
}
```

Also add `draft` to the useEffect dependency array (alongside `state.screen` and `dispatch`).

- [ ] **Step 2: Update shortcuts overlay in `EditorScreen.tsx`**

In the keyboard shortcuts dialog (around line 373), update the keys data:

```typescript
{ group: "File", keys: [["Ctrl+S", "Save Draft"], ["Ctrl+Shift+S", "Save Draft As"], ["Ctrl+O", "Open Draft"], ["Ctrl+E", "Export current JPEG"]] },
{ group: "Navigation", keys: [["Arrow Up / Down", "Previous / Next image"]] },
{ group: "Editing", keys: [["Ctrl+Z", "Undo"], ["Ctrl+Shift+Z", "Redo"], ["R", "Rotate 90° CW"], ["Shift+R", "Rotate 90° CCW"]] },
{ group: "Eraser", keys: [["E", "Toggle eraser mode"], ["B", "Brush tool"], ["L", "Lasso tool"], ["[ / ]", "Brush size -/+"]] },
```

- [ ] **Step 3: Verify** — `npm run build` passes. In the app, press Ctrl+S → should prompt for directory (first time). Press Ctrl+E → should export JPEG.

- [ ] **Step 4: Commit**

```bash
git add src/hooks/useKeyboardShortcuts.ts src/components/EditorScreen.tsx
git commit -m "feat: update keyboard shortcuts — ⌘S saves draft, ⌘E exports JPEG, ⌘O opens draft"
```

---

### Task 9: End-to-End Verification & Fix Crop Rebuild on Draft Load

**Files:**
- Possibly modify: `src/components/EditorScreen.tsx`

- [ ] **Step 1: Test the full save/load cycle**

Manual test procedure:
1. Open the app in Chrome
2. Drop 2-3 images → wait for AI detection
3. Edit some corners, rotate one image, apply B&W filter to another
4. Press ⌘S → select a folder → verify files appear in Finder (manifest.json + original-*.jpg + mask-*.bin)
5. Wait 2 seconds after another edit → verify manifest.json `savedAt` updates (auto-save)
6. Refresh the page → on UploadScreen, click "Open Recent Draft" → grant permission → verify all images load back with correct edit states
7. Verify crop preview recalculates automatically (may take a moment)

- [ ] **Step 2: Verify crop rebuild works for draft-loaded images**

The existing EditorScreen pipeline recomputes `cropCanvas` when `editState` exists but `cropCanvas` is null. Verify this works for draft-loaded images. If the crop doesn't trigger because the `cropKey` comparison prevents it (initial `prevCropKeyRef` is null, so it should trigger), no code change needed.

If crop rebuild doesn't trigger for non-selected images, add a useEffect in EditorScreen that iterates draft-loaded images and triggers crop computation. This would look like:

```typescript
// Trigger crop recomputation for draft-loaded images
useEffect(() => {
  for (const img of state.images) {
    if (img.editState && img.originalCanvas && !img.cropCanvas && img.id !== state.selectedImageId) {
      const quadResult = {
        corners: img.editState.corners,
        edges: img.initialQuad?.edges ?? [],
        edgeFits: img.editState.edgeFits,
      };
      const cropCanvas = perspectiveCrop(img.originalCanvas, quadResult, img.maskWidth, img.maskHeight);
      dispatch({ type: "UPDATE_IMAGE", id: img.id, updates: { cropCanvas } });
    }
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [state.images.map(img => `${img.id}:${img.cropCanvas ? 1 : 0}`).join(",")]);
```

Only add this if non-selected images don't get their crops rebuilt automatically.

- [ ] **Step 3: Verify PDF export and ZIP export still work with draft-loaded images**

Since `ImageEntry.file` is now nullable, verify that export functions don't reference `.file`. Looking at the current code, `handleExport` and `handleExportAll` in TopBar use `fileName` (not `file`), so this should work. Verify manually.

- [ ] **Step 4: Commit if any fixes were needed**

```bash
git add -A
git commit -m "fix: ensure crop rebuild and export work correctly with draft-loaded images"
```

---

### Task 10: Final Lint & Build Check

- [ ] **Step 1: Run lint**

```bash
npm run lint
```

Fix any warnings/errors.

- [ ] **Step 2: Run build**

```bash
npm run build
```

Ensure static export succeeds with no errors.

- [ ] **Step 3: Commit any lint fixes**

```bash
git add -A
git commit -m "fix: lint and build cleanup for draft persistence feature"
```
