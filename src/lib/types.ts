// --- Segmentation & Quad Detection ---

export interface EdgeFit {
  cp1: [number, number];
  cp2: [number, number];
  isArc: boolean;
}

export interface QuadResult {
  corners: [number, number][];
  edges: [number, number][][];
  edgeFits: EdgeFit[];
}

export interface InferenceResult {
  mask: Uint8Array;
  duration: number;
  width: number;
  height: number;
}

// --- Editor State ---

export interface EditState {
  corners: [number, number][];
  edgeFits: EdgeFit[];
  rotation: 0 | 90 | 180 | 270;
}

export interface ImageHistory {
  past: EditState[];
  future: EditState[];
}

// --- Image Entry ---

export type ImageStatus = "pending" | "processing" | "ready" | "error";

export interface ImageEntry {
  id: string;
  file: File;
  fileName: string;
  originalCanvas: HTMLCanvasElement | null;
  mask: Uint8Array | null;
  maskWidth: number;
  maskHeight: number;
  initialQuad: QuadResult | null;
  editState: EditState | null; // null = crop cancelled
  history: ImageHistory;
  cropCanvas: HTMLCanvasElement | null;
  status: ImageStatus;
  error?: string;
}

// --- App State ---

export type AppScreen = "upload" | "editor";

export interface AppState {
  screen: AppScreen;
  images: ImageEntry[];
  selectedImageId: string | null;
  modelLoaded: boolean;
  modelLoading: boolean;
}

// --- Selection ---

export interface PointSelection {
  type: "corner" | "cp1" | "cp2";
  edgeIdx: number;
}

// --- Constants ---

export const INPUT_SIZE = 256;
export const EDGE_LABELS = ["Top", "Right", "Bottom", "Left"] as const;
export const MAX_PREVIEW_SIZE = 800;
