import type { ImageEntry, EditState, EdgeFit, EraseMask, QuadResult, ImageHistory } from "./types";

// --- Manifest Types ---

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

interface ManifestEditState {
  corners: [number, number][];
  edgeFits: EdgeFit[];
  guideLines?: { pos: number; axis: "h" | "v" }[];
  dewarpGuides?: { p0: [number, number]; p3: [number, number]; cp1: [number, number]; cp2: [number, number] }[];
  alignGuides?: { p0: [number, number]; p1: [number, number] }[];
  rotation: 0 | 90 | 180 | 270;
  filterConfig: { type: "none" | "binarize"; binarize: { blockRadiusBps: number; contrastOffset: number; upsamplingScale: number } };
  eraseMaskFile: string | null;
}

interface Manifest {
  version: number;
  savedAt: string;
  showMask: boolean;
  showGuides: boolean;
  images: ManifestImage[];
}

export interface DraftData {
  showMask: boolean;
  showGuides: boolean;
  images: ImageEntry[];
}

export interface ManifestInfo {
  version: number;
  savedAt: string;
  imageCount: number;
  fileNames: string[];
}

// --- Helper Functions ---

function editStateToManifest(es: EditState, eraseMaskFile: string | null): ManifestEditState {
  return {
    corners: es.corners.map(c => [...c] as [number, number]),
    edgeFits: es.edgeFits.map(f => ({ cp1: [...f.cp1] as [number, number], cp2: [...f.cp2] as [number, number], isArc: f.isArc })),
    guideLines: es.guideLines.map(g => ({ pos: g.pos, axis: g.axis })),
    dewarpGuides: es.dewarpGuides.map(g => ({ p0: [...g.p0] as [number, number], p3: [...g.p3] as [number, number], cp1: [...g.cp1] as [number, number], cp2: [...g.cp2] as [number, number] })),
    alignGuides: es.alignGuides.map(g => ({ p0: [...g.p0] as [number, number], p1: [...g.p1] as [number, number] })),
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
    guideLines: (m.guideLines ?? []).map(g => ({ pos: g.pos, axis: g.axis })),
    dewarpGuides: (m.dewarpGuides ?? []).map(g => ({ p0: [...g.p0] as [number, number], p3: [...g.p3] as [number, number], cp1: [...g.cp1] as [number, number], cp2: [...g.cp2] as [number, number] })),
    alignGuides: (m.alignGuides ?? []).map(g => ({ p0: [...g.p0] as [number, number], p1: [...g.p1] as [number, number] })),
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

// --- Exported Write Functions ---

export async function saveDraft(
  dirHandle: FileSystemDirectoryHandle,
  images: ImageEntry[],
  showMask: boolean,
  dirtyIds: Set<string> | null, // null = save all (first save)
  showGuides: boolean = false,
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
        await writeFile(dirHandle, maskFile, img.mask.buffer as ArrayBuffer);
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
      await writeFile(dirHandle, eraseMaskFile, combined.buffer as ArrayBuffer);
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
    showGuides,
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
  // FileSystemDirectoryHandle.entries() is not in TypeScript's DOM types yet
  const iterableDir = dirHandle as unknown as AsyncIterable<[string, FileSystemHandle]>;
  for await (const [name] of iterableDir) {
    toDelete.push(name);
  }
  for (const name of toDelete) {
    if (!keepNames.has(name)) {
      try {
        await dirHandle.removeEntry(name);
      } catch {
        // Ignore errors removing stale files
      }
    }
  }
}

// --- Exported Read Functions ---

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

    // Rebuild history (eraseMasks in history are not persisted — they're null)
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
      cropCanvas: null,
      filteredCanvas: null,
      status: originalCanvas ? "ready" : "error",
      error: originalCanvas ? undefined : "Failed to load image from draft",
    });
  }

  return {
    showMask: manifest.showMask,
    showGuides: manifest.showGuides ?? false,
    images,
  };
}
