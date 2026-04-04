# Document Auto-Crop

A client-side document cropping web app with AI-powered boundary detection. Upload photos of documents (sheet music, papers, etc.), auto-detect edges using a segmentation model, refine with interactive bezier curve editing, apply B&W filters with eraser tools, and export as JPEG, ZIP, or multi-page PDF with CCITT G4 compression.

All processing runs in the browser. No backend required.

## Features

- **AI boundary detection** -- ONNX segmentation model (DeepLabV3+ MobileNetV2) detects document edges automatically
- **Interactive quad editor** -- Drag corners and bezier control points to refine crop boundaries
- **B&W filter** -- Adaptive threshold binarization with configurable parameters
- **Eraser tool** -- Brush and lasso modes to erase unwanted marks on B&W images
- **PDF export** -- Multi-page PDF with CCITT G4 encoding, configurable page sizes (music publisher presets, A4, Letter, custom)
- **Batch operations** -- Rotate and apply filters to all images at once
- **Image management** -- Drag-and-drop reorder, remove, and sort images
- **HiDPI rendering** -- Progressive downscaling with DPR-aware canvas for Retina displays

## Scripts

```bash
npm run dev      # Start dev server (Turbopack) at localhost:3000
npm run build    # Static export build (output: 'export')
npm run lint     # ESLint
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 16 (App Router, static export) |
| Language | TypeScript 5 |
| UI | React 19, Tailwind CSS v4 |
| AI Inference | ONNX Runtime Web (WASM) via Web Worker |
| PDF | pdf-lib + ts-ccitt-g4-encoder via Web Worker |
| DND | @dnd-kit/core + @dnd-kit/sortable |

## Architecture

```
Upload → ONNX inference (worker) → Quad detection → Interactive editor
                                                          ↓
                                          Perspective crop (Coons patch)
                                                          ↓
                                    B&W filter (worker) → Eraser → Export
```

Processing pipeline runs entirely in Web Workers to keep the UI responsive. State management uses React `useReducer` with per-image undo/redo history (50 levels).
