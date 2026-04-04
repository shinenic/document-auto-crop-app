# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## Commands

```bash
npm run dev      # Start dev server (Turbopack)
npm run build    # Static export build (output: 'export')
npm run lint     # ESLint (flat config, no args needed)
```

No test framework is configured. No backend — everything runs client-side.

## Architecture

This is a **static-export Next.js 16** app (App Router) for client-side document cropping with AI-powered boundary detection. All processing happens in the browser.

### Processing Pipeline

1. User drops image files -> `imageProcessor.ts` orchestrates the pipeline
2. ONNX model (`public/model/fairscan-segmentation-model.onnx`) runs in a **Web Worker** (`segmentation.worker.ts`) via `segmentation.ts` message-passing layer
3. 256x256 inference mask -> `quad.ts` detects document quadrilateral (morphological ops, contour tracing, convex hull, corner finding, bezier fitting)
4. `crop.ts` performs perspective correction via Coons patch + homography at full source resolution
5. `overlay.ts` renders the mask overlay and quad contour on the editor canvas

### State Management

Global state lives in `context/AppContext.tsx` using `useReducer`. Key patterns:
- Per-image undo/redo history stacks (capped at 50)
- `editState: null` means crop is cancelled for that image
- `editStateFromQuad()` converts inference results to editable state
- Stale closure prevention: `EditorScreen` uses a `stateRef` for fresh reads inside `requestAnimationFrame` callbacks

### Key Types

All shared types in `lib/types.ts`. The core data flow: `File` -> `ImageEntry` (with `originalCanvas`, `mask`, `initialQuad`, `editState`, `cropCanvas`).

### Crop Resolution Strategy

- During drag: capped at 800px for real-time preview
- On drag end / export: full original resolution from `originalCanvas`
- Source pixels always from original, never from 256x256 inference input

## Spec

The full product specification is in `docs/SPEC.md`. Consult it for UI layout, keyboard shortcuts, data model details, and known limitations.

## Design Context

### Users
Music publishers and engravers processing sheet music scans at professional volume. Speed and accuracy matter more than hand-holding.

### Brand Personality
**Fast, Efficient, Technical.** The tool should feel like a sharp instrument — responsive, no-nonsense, zero wasted space.

### Aesthetic Direction
- Dark mode only. Deep near-black backgrounds with subtle blue undertones.
- Teal accent (#5ce0c2) used sparingly for active states and primary actions.
- System fonts. Monospace for numeric values. No decorative fonts.
- References: Apple Preview (simplicity), Affinity Photo (professional dense panels).
- Anti-references: Decorative/playful UIs, heavy gradients, bubbly components, excessive animations.

### Design Principles
1. **Content first** — The image is the hero. UI chrome should be minimal and recede.
2. **Density without clutter** — Pack controls tightly but maintain clear hierarchy through spacing and typography weight.
3. **Instant feedback** — Every interaction should feel immediate. Real-time previews over loading spinners.
4. **Predictable controls** — Standard patterns (toggles, sliders, dropdowns). No clever custom widgets.
5. **Accessible by default** — WCAG AA contrast. Keyboard shortcuts for all major actions. Clear focus indicators.
