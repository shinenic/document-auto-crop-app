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
  blockRadiusBps: 50,
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

// --- Guide Lines ---

export interface GuideLine {
  pos: number;    // 0-1 percentage
  axis: "h" | "v"; // horizontal or vertical
}

/** A user-drawn dewarp guide: cubic Bézier with endpoints freely placed inside the quad.
 *  The system extrapolates to quad L/R edges for piecewise Coons patch boundaries. */
export interface DewarpGuide {
  p0: [number, number];    // left endpoint (mask space)
  p3: [number, number];    // right endpoint (mask space)
  cp1: [number, number];   // Bezier control point 1 (mask space)
  cp2: [number, number];   // Bezier control point 2 (mask space)
}

/** A user-drawn align guide: straight line that should become perfectly vertical in the output.
 *  The system extrapolates to quad T/B edges for column boundaries in the 2D Coons patch grid. */
export interface AlignGuide {
  p0: [number, number];    // top endpoint (mask space)
  p1: [number, number];    // bottom endpoint (mask space)
}

// --- Editor State ---

export interface EditState {
  corners: [number, number][];
  edgeFits: EdgeFit[];
  rotation: 0 | 90 | 180 | 270;
  filterConfig: FilterConfig;
  eraseMask: EraseMask | null;
  guideLines: GuideLine[];        // reference lines (original)
  dewarpGuides: DewarpGuide[];    // staff line dewarping curves
  alignGuides: AlignGuide[];      // vertical alignment lines
}

export interface ImageHistory {
  past: EditState[];
  future: EditState[];
}

// --- Image Entry ---

export type ImageStatus = "pending" | "processing" | "ready" | "error";

export interface ImageEntry {
  id: string;
  file: File | null;
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
  showMask: boolean;
  showGuides: boolean;
}

// --- Selection ---

export interface PointSelection {
  type: "corner" | "cp1" | "cp2" | "edge" | "guide-left" | "guide-right" | "guide-cp1" | "guide-cp2" | "guide-body" | "align-top" | "align-bottom" | "align-body";
  edgeIdx: number;  // for quad points: edge index; for guide/align points: guide index
}

// --- Constants ---

export const INPUT_SIZE = 256;
export const EDGE_LABELS = ["Top", "Right", "Bottom", "Left"] as const;
export const MAX_PREVIEW_SIZE = 800;

// --- PDF Page Sizes ---

export interface PdfPageSize {
  label: string;
  widthMm: number;   // 0 = fit to image
  heightMm: number;  // 0 = fit to image
}

export const PDF_PAGE_SIZES: PdfPageSize[] = [
  // Auto-detect
  { label: "Auto Detect PDF Size", widthMm: 0, heightMm: 0 },
  // Music portrait
  { label: "Music 9×12″", widthMm: 229, heightMm: 305 },
  { label: "Music Euro", widthMm: 235, heightMm: 310 },
  { label: "Music Large", widthMm: 240, heightMm: 325 },
  // Standard portrait
  { label: "A4", widthMm: 210, heightMm: 297 },
  { label: "A3", widthMm: 297, heightMm: 420 },
  { label: "Letter", widthMm: 215.9, heightMm: 279.4 },
  // Landscape
  { label: "A4 Landscape", widthMm: 297, heightMm: 210 },
  { label: "Music 12×9″", widthMm: 305, heightMm: 229 },
  { label: "A3 Landscape", widthMm: 420, heightMm: 297 },
  // Custom (user enters dimensions)
  { label: "Custom", widthMm: -2, heightMm: -2 },
  // Fit to image (each page different)
  { label: "Fit to Image", widthMm: -1, heightMm: -1 },
];

/**
 * Find the closest page size based on average image dimensions.
 * Compares aspect ratio similarity and area proximity.
 */
export function detectBestPageSize(
  images: { width: number; height: number }[],
): PdfPageSize {
  if (images.length === 0) return PDF_PAGE_SIZES[1]; // fallback Music 9×12

  // Compute average aspect ratio from cropped images
  let sumRatio = 0;
  let sumW = 0;
  let sumH = 0;
  for (const img of images) {
    sumRatio += img.width / img.height;
    sumW += img.width;
    sumH += img.height;
  }
  const avgRatio = sumRatio / images.length;
  const avgW = sumW / images.length;
  const avgH = sumH / images.length;

  // Estimate physical size assuming 300 DPI
  const avgWMm = (avgW / 300) * 25.4;
  const avgHMm = (avgH / 300) * 25.4;

  // Score each fixed page size (skip Auto Detect and Fit to Image)
  let bestScore = Infinity;
  let best: PdfPageSize = PDF_PAGE_SIZES[1];

  for (const ps of PDF_PAGE_SIZES) {
    if (ps.widthMm <= 0) continue; // skip auto/fit
    const psRatio = ps.widthMm / ps.heightMm;
    const ratioDiff = Math.abs(psRatio - avgRatio) / avgRatio;
    const sizeDiff =
      (Math.abs(ps.widthMm - avgWMm) + Math.abs(ps.heightMm - avgHMm)) /
      (avgWMm + avgHMm);
    const score = ratioDiff * 2 + sizeDiff; // weight ratio more
    if (score < bestScore) {
      bestScore = score;
      best = ps;
    }
  }

  return best;
}
