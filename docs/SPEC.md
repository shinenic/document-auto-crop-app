# Document Auto-Crop App - Specification

> **Living document.** Update after every feature change.

## Goal

A multi-image document cropping web application. Users upload photos of documents; the app auto-detects document boundaries using an AI segmentation model, then provides an interactive editor for refining the crop with bezier curves. Exported images maintain the original source resolution.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 16 (App Router, `output: 'export'` for static site, Turbopack) |
| Language | TypeScript 5 |
| UI | React 19, Tailwind CSS v4 |
| AI Inference | ONNX Runtime Web (WASM backend) via Web Worker |
| Model | DeepLabV3+ MobileNetV2 (256x256 input, binary mask output) |
| Design | Impeccable design system |

All processing is client-side. No backend required.

## Screens

### Screen 1: Upload

Full-screen drop zone. Users drag images or click to open file selector. Transitions to Screen 2 once images are added.

### Screen 2: Editor

```
+-------------------------------------------------------------+
|  [+ Add Images]                              [Export / Download] |
+--------+-----------------------------+----------------------+
|        |              |              |                      |
| Image  |   Original   |    Crop      |    Tools             |
| List   |   + Editor   |   Preview    |    - Undo            |
| (thumb)|   Overlay    |   (real-time)|    - Redo             |
|        |              |              |    - Rotate CW        |
|  vert  |  Interactive |  Full-res    |    - Rotate CCW       |
| scroll |  quad editor |  output      |    - Reset (predict)  |
|        |              |              |    - Cancel crop      |
|        |              |              |    - Add bezier CP    |
|        |              |              |    - Remove bezier CP |
+--------+-----------------------------+----------------------+
```

**Left panel (Image List):** Vertical scrollable thumbnail list. Click to select. Shows processing state indicator.

**Center-left (Quad Editor):** Original image with semi-transparent mask overlay. Draggable corners (red circles) and bezier control points (blue circles). Cyan lines for straight edges, orange curves for bezier edges. Guide lines from corners to control points.

**Center-right (Crop Preview):** Real-time perspective-corrected crop using Coons patch. Updates during drag (throttled low-res), full-res on drag end. Shows rotation applied.

**Right panel (Tools):** Action buttons for editing operations. Each operation is undoable.

## Data Model

```typescript
interface EdgeFit {
  cp1: [number, number];
  cp2: [number, number];
  isArc: boolean;
}

interface QuadResult {
  corners: [number, number][];
  edges: [number, number][][];
  edgeFits: EdgeFit[];
}

interface EditState {
  corners: [number, number][];
  edgeFits: EdgeFit[];
  rotation: 0 | 90 | 180 | 270;
}

interface ImageEntry {
  id: string;
  file: File;
  fileName: string;
  originalCanvas: HTMLCanvasElement | null;
  mask: Uint8Array | null;
  maskWidth: number;
  maskHeight: number;
  initialQuad: QuadResult | null;
  editState: EditState | null;     // null = crop cancelled
  history: { past: EditState[]; future: EditState[] };
  cropCanvas: HTMLCanvasElement | null; // full-res crop result
  status: 'pending' | 'processing' | 'ready' | 'error';
  error?: string;
}
```

## Undo/Redo System

Per-image history stacks. Each undoable operation:
1. Pushes current `editState` snapshot to `past[]`
2. Clears `future[]`
3. Applies new state

| Operation | Undoable |
|-----------|----------|
| Drag corner/CP (mouseDown→mouseUp) | Yes |
| Rotate 90 CW/CCW | Yes |
| Toggle edge curve | Yes |
| Reset to prediction | Yes |
| Cancel crop | Yes |

**Undo:** Pop `past` → set as current, push old current to `future`.
**Redo:** Pop `future` → set as current, push old current to `past`.

## Crop Quality Strategy

| Context | Resolution | Purpose |
|---------|-----------|---------|
| During drag | Capped at 800px max dimension | Real-time preview (~20ms) |
| On drag end | Full original resolution | Display & export quality |
| Export/download | Full original resolution + rotation | Final output |

Source pixels are always sampled from `originalCanvas` (full-res), never from the 256x256 inference input.

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `Ctrl+Z` / `Cmd+Z` | Undo |
| `Ctrl+Shift+Z` / `Cmd+Shift+Z` | Redo |
| `Ctrl+Y` / `Cmd+Y` | Redo (alt) |
| `R` | Rotate 90 CW |
| `Shift+R` | Rotate 90 CCW |
| `ArrowUp` / `ArrowDown` | Navigate images |
| `Ctrl+S` / `Cmd+S` | Export current image |
| `Delete` / `Backspace` | Remove bezier CPs from selected edge (planned) |
| `Escape` | Deselect (planned) |
| `Ctrl+Shift+S` / `Cmd+Shift+S` | Export all images (planned) |

## Reused Logic from `/demo`

All AI/vision code is ported from the demo project:

| Module | Source | Algorithms |
|--------|--------|-----------|
| Segmentation worker | `demo/src/lib/segmentation.worker.js` | ONNX inference, RGBA→RGB conversion, threshold |
| Quad detection | `demo/src/lib/segmentation.js` | Morphological opening, contour tracing, convex hull, farthest-point corners, PCA line fitting, intersection, edge classification, bezier fitting |
| Perspective crop | `demo/src/lib/segmentation.js` | Coons patch (arc-length parameterized), homography, bilinear interpolation |
| Overlay rendering | `demo/src/lib/segmentation.js` | Mask overlay, quad contour drawing |

## File Structure

```
document-auto-crop-app/
├── docs/
│   └── SPEC.md                    ← this file
├── public/
│   └── model/
│       └── fairscan-segmentation-model.onnx
├── src/
│   ├── app/
│   │   ├── layout.tsx
│   │   ├── page.tsx
│   │   └── globals.css
│   ├── components/
│   │   ├── UploadScreen.tsx       Screen 1: drag-drop upload
│   │   ├── EditorScreen.tsx       Screen 2: main editor layout
│   │   ├── TopBar.tsx             Add images + export buttons
│   │   ├── ImageList.tsx          Left: scrollable thumbnails
│   │   ├── QuadEditor.tsx         Center-left: interactive canvas
│   │   ├── CropPreview.tsx        Center-right: crop result display
│   │   ├── ToolPanel.tsx          Right: editing tools
│   │   └── imageProcessor.ts     Image loading + inference pipeline
│   ├── lib/
│   │   ├── types.ts               Shared TypeScript types
│   │   ├── segmentation.ts        Worker communication (loadModel, runInference)
│   │   ├── segmentation.worker.ts ONNX inference web worker
│   │   ├── quad.ts                Quad detection algorithms
│   │   ├── crop.ts                Perspective crop (Coons + homography)
│   │   └── overlay.ts             Mask overlay rendering
│   ├── context/
│   │   └── AppContext.tsx          Global state (useReducer + context)
│   └── hooks/
│       └── useKeyboardShortcuts.ts
├── package.json
├── next.config.ts
├── tsconfig.json
├── tailwind.config.ts
└── postcss.config.mjs
```

## Implementation Notes

- **Stale closure prevention:** `EditorScreen` uses a `stateRef` to always read fresh state inside `requestAnimationFrame` callbacks during drag.
- **Straight-edge CP sync:** When a corner is dragged, adjacent straight-edge control points are automatically recomputed as 1/3 and 2/3 interpolation.
- **Auto-select behavior:** Adding more images does not change the user's current selection.
- **History limit:** Undo history is capped at 50 entries per image.
- **Coons patch edge reversal:** Bottom and left edges use reversed control points to match the Coons patch parameterization direction.

## Known Limitations / Planned

- `Delete`/`Backspace` to remove bezier CPs requires lifting selection state from `QuadEditor` to `AppContext`.
- `Escape` deselect requires same selection state lifting.
- `Ctrl+Shift+S` export-all shortcut not yet wired to keyboard.
- Touch/mobile interaction not yet supported (mouse-only).
- No multi-select for batch operations on image list.
