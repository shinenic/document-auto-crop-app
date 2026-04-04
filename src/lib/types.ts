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

// --- Filter Config ---

export interface BinarizeConfig {
  blockRadiusBps: number;   // basis points; actual radius = sqrt(W*H*bps/10000)
  contrastOffset: number;   // bias added to local mean (negative = favor white)
  upsamplingScale: number;  // percentage (200 = 2x upscale before threshold)
}

export interface FilterConfig {
  type: "none" | "binarize";
  binarize: BinarizeConfig;  // always present so settings persist when toggling
}

export const DEFAULT_BINARIZE_CONFIG: BinarizeConfig = {
  blockRadiusBps: 300,
  contrastOffset: -25,
  upsamplingScale: 200,
};

export const DEFAULT_FILTER_CONFIG: FilterConfig = {
  type: "none",
  binarize: { ...DEFAULT_BINARIZE_CONFIG },
};

// --- Erase Mask ---

export interface EraseMask {
  width: number;
  height: number;
  data: Uint8Array; // single-channel: 255 = erased (white), 0 = keep
}

// --- Editor State ---

export interface EditState {
  corners: [number, number][];
  edgeFits: EdgeFit[];
  rotation: 0 | 90 | 180 | 270;
  filterConfig: FilterConfig;
  eraseMask: EraseMask | null;
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
  filteredCanvas: HTMLCanvasElement | null;
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
