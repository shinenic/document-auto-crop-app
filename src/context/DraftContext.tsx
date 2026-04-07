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

        const perm = await (handle as FileSystemDirectoryHandle & { queryPermission: (opts: { mode: string }) => Promise<string> }).queryPermission({ mode: "readwrite" });
        if (perm === "granted") {
          const info = await loadManifestOnly(handle);
          if (info) {
            setRecentDraftInfo(info);
          } else {
            await idbDelete(IDB_HANDLE_KEY);
          }
        } else {
          // Can't read without permission — show generic button
          setRecentDraftInfo({ version: 0, savedAt: "", imageCount: 0, fileNames: [] });
        }
      } catch {
        // Silently ignore
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
      const dirtyIds = savedImageIdsRef.current.size === 0
        ? null
        : new Set(s.images.filter(img => !savedImageIdsRef.current.has(img.id)).map(img => img.id));

      await saveDraft(handle, s.images, s.showMask, dirtyIds);

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
  }, [state.images, state.showMask, state.screen, doSave]);

  const save = useCallback(async () => {
    if (!isSupported) return;
    let handle = dirHandleRef.current;
    if (!handle) {
      try {
        handle = await (window as Window & typeof globalThis & { showDirectoryPicker: (opts?: { mode?: string }) => Promise<FileSystemDirectoryHandle> }).showDirectoryPicker({ mode: "readwrite" });
      } catch {
        return;
      }
      setDirHandle(handle);
      dirHandleRef.current = handle;
      await idbSet(IDB_HANDLE_KEY, handle);
    }
    await doSave(handle);
  }, [isSupported, doSave]);

  const saveAs = useCallback(async () => {
    if (!isSupported) return;
    let handle: FileSystemDirectoryHandle;
    try {
      handle = await (window as Window & typeof globalThis & { showDirectoryPicker: (opts?: { mode?: string }) => Promise<FileSystemDirectoryHandle> }).showDirectoryPicker({ mode: "readwrite" });
    } catch {
      return;
    }
    setDirHandle(handle);
    dirHandleRef.current = handle;
    savedImageIdsRef.current = new Set();
    await idbSet(IDB_HANDLE_KEY, handle);
    await doSave(handle);
  }, [isSupported, doSave]);

  const openDraft = useCallback(async () => {
    if (!isSupported) return;
    let handle: FileSystemDirectoryHandle;
    try {
      handle = await (window as Window & typeof globalThis & { showDirectoryPicker: (opts?: { mode?: string }) => Promise<FileSystemDirectoryHandle> }).showDirectoryPicker({ mode: "readwrite" });
    } catch {
      return;
    }
    try {
      const data = await loadDraft(handle);
      setDirHandle(handle);
      dirHandleRef.current = handle;
      savedImageIdsRef.current = new Set(data.images.map(img => img.id));
      savedCounter.current = changeCounter.current;
      await idbSet(IDB_HANDLE_KEY, handle);
      setLastSavedAt(new Date().toISOString());
      dispatch({ type: "LOAD_DRAFT", images: data.images, showMask: data.showMask });
    } catch (e) {
      console.error("Failed to load draft:", e);
    }
  }, [isSupported, dispatch]);

  const openRecentDraft = useCallback(async () => {
    if (!isSupported) return;
    const handle = await idbGet<FileSystemDirectoryHandle>(IDB_HANDLE_KEY);
    if (!handle) return;

    const perm = await (handle as FileSystemDirectoryHandle & { requestPermission: (opts: { mode: string }) => Promise<string> }).requestPermission({ mode: "readwrite" });
    if (perm !== "granted") return;

    try {
      const data = await loadDraft(handle);
      setDirHandle(handle);
      dirHandleRef.current = handle;
      savedImageIdsRef.current = new Set(data.images.map(img => img.id));
      savedCounter.current = changeCounter.current;
      setLastSavedAt(new Date().toISOString());
      dispatch({ type: "LOAD_DRAFT", images: data.images, showMask: data.showMask });
    } catch (e) {
      console.error("Failed to load recent draft:", e);
    }
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
