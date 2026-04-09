# Auto Staff Line Detection — Design Spec

## Goal

Detect staff lines (five-line staves) in sheet music images and present them as editable dewarp guides, enabling users to correct curved staves before export.

## User Flow

1. User clicks "Auto Detect" button in ToolPanel's dewarp guides section
2. System applies default B&W binarization to the original image
3. Web Worker loads OpenCV.js (CDN, cached after first load) and runs Phase 2-5 from the handover algorithm
4. Detected lines are converted to `DewarpGuide` objects and appended to existing guides
5. Toast: "Detected N staff lines" or "No staff lines detected"

## Architecture

### New Files

| File | Purpose |
|------|---------|
| `src/lib/staves.ts` | Main-thread API: sends binarized ImageData to worker, receives control points, converts to DewarpGuide[] |
| `src/lib/staves.worker.ts` | Web Worker: loads OpenCV.js via CDN, executes Phases 2-5, returns point arrays |

### Data Flow

```
originalCanvas
  → applyBinarize(defaultConfig) → binarized ImageData
  → postMessage to staves.worker
  → Worker: Phase 2 (vertical morphology) → Phase 3 (horizontal erode/dilate) → Phase 4 (contour detection) → Phase 5 (polyline extraction + smoothing + downsampling)
  → Worker returns: Array<Array<{x: number, y: number}>>
  → Main thread: fitBezierToPoints() → DewarpGuide[]
  → Append to editState.dewarpGuides
  → Push history, recompute crop
  → Show toast
```

### Control Points → DewarpGuide Conversion

The handover outputs Catmull-Rom control points (10-50 points per line). `DewarpGuide` is a single cubic Bezier (p0, cp1, cp2, p3). Conversion:

- **p0** = first point (left end)
- **p3** = last point (right end)
- **cp1, cp2** = least-squares fit of all intermediate points to a cubic Bezier curve

### OpenCV.js Loading

- Worker uses `importScripts('https://docs.opencv.org/4.9.0/opencv.js')` on first message
- Worker stays alive after initialization; subsequent calls skip loading
- Load failure → error message back to main thread → toast

### Algorithm Parameters (hardcoded defaults)

| Parameter | Value | Description |
|-----------|-------|-------------|
| `maxRunLen` | 5 | Vertical kernel half-height |
| `kernelLen` | 40 | Horizontal erode/dilate kernel width |
| `minLenPct` | 0.4 | Minimum contour width as fraction of image width |
| `smoothWin` | 50 | Moving average window size |
| `ctrlStep` | 25 | Control point sampling interval |

Derived: `blockSize = round(imgW/30)`, odd, min 15. Small erode kernel = `round(kernelLen/3)`. Trim = `max(5, round(count * 0.02))`.

## UI Changes

### ToolPanel.tsx

- Add "Auto Detect" button in the dewarp guides section, next to "+ Add Dewarp"
- Button shows spinner + disabled state during detection
- Musical note or wand icon

### EditorScreen.tsx

- New `handleAutoDetectStaves()` handler
- Manages loading state, calls staves.ts API, dispatches results to context
- Calls `showToast()` with result count

## Edge Cases

- **No lines detected**: Toast "No staff lines detected", no guides added
- **OpenCV load failure**: Toast with error message
- **No editState / crop cancelled**: Button disabled
- **Image too small**: Algorithm handles gracefully (contours filtered out by minLenPct)
- **Existing guides**: New guides are appended, not replaced

## Coordinates

All coordinates in mask space (256x256 inference resolution), consistent with existing dewarp guides. The worker receives full-resolution binarized image but output points are scaled to mask space before conversion.

Wait — existing dewarp guides use mask space coordinates. The staff detection works on the full-resolution binarized image. Points must be scaled from full resolution to mask space (256x256) before creating DewarpGuide objects.
