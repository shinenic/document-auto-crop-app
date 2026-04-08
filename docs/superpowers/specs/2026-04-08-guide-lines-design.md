# Guide Lines Feature Design

## Overview

Add horizontal guide lines to the CropPreview canvas to help users verify that staff lines in sheet music scans are horizontally aligned after perspective correction. The feature is off by default and provides freely draggable lines with global/per-image scope control.

## Target Users

Music publishers and engravers processing sheet music scans at professional volume. They need a quick visual check that staff lines are straight and level after cropping.

## Activation

- **TopBar toggle**: A `Guides` button in the TopBar right section, styled identically to the existing `Mask` button. Teal accent when active, muted when inactive.
- **View menu**: A `Show Guide Lines` menu item with checkmark, shortcut key `G`.
- **Default state**: Off (`showGuides: false`).

## Controls — Preview Header

When guides are active, controls appear in the Preview header bar (the `<h4>Preview</h4>` strip), right-aligned. When guides are off, these controls are hidden.

| Control | Appearance | Behavior |
|---------|-----------|----------|
| `+ Add` | Small button, muted text | Adds a new guide line at the vertical center of the canvas |
| Line count | Teal monospace number (e.g. `3`) | Display only |
| `G / L` toggle | Two-segment pill, `G` = Global, `L` = Local | Switches between global and per-image guide lines |
| `Clear` | Muted text button | Removes all guide lines in the current scope (global or local) |

## Guide Line Visual Design

- **Color**: `rgba(92, 224, 194, 0.5)` — teal, semi-transparent
- **Width**: 1px with subtle glow (`box-shadow: 0 0 3px rgba(92, 224, 194, 0.3)`)
- **Hover state**: Opacity increases to 0.8, cursor changes to `ns-resize`
- **Span**: Full width of the rendered crop image (not the canvas background)
- **Rendering layer**: Drawn on top of the crop image but beneath the eraser/lasso overlay

## Interaction

| Action | Behavior |
|--------|----------|
| Click `+ Add` button | New line appears at vertical center of canvas |
| Click empty area on CropPreview canvas | New line appears at the clicked Y position |
| Drag a guide line | Moves vertically, snaps to mouse Y position |
| Drag a guide line outside the canvas bounds | Removes the line |
| Select a line + press `Delete` or `Backspace` | Removes the line |
| Click `Clear` | Removes all lines in current scope |
| Press `G` (keyboard shortcut) | Toggles guide line visibility |

**Click-to-add vs eraser conflict**: When the eraser tool is active, clicks on the canvas should perform eraser actions, not add guide lines. The `+ Add` button remains functional regardless of eraser state.

## Global / Local Scope

### Global Mode (default)

- All images share one set of guide line positions.
- Positions are stored as **percentages (0–1)** relative to image height, so they approximate the same visual position across images of different dimensions.
- Moving a line in Global mode updates the shared set; all images reflect the change.

### Local Mode

- Switching to `L` detaches the current image from the global set.
- The image gets its own independent copy of guide line positions (initialized from the current global positions at the moment of switching).
- Edits in Local mode only affect this image.
- Switching back to `G` re-attaches to the global set. The local positions are preserved in state but hidden — switching to `L` again restores them.

### Scope indicator

The `G / L` pill in the Preview header shows which mode is active for the currently selected image.

## State Model

### AppState additions

```typescript
showGuides: boolean;           // visibility toggle, default false
globalGuideLines: number[];    // array of Y positions as percentages (0–1)
```

### ImageEntry additions

```typescript
localGuideLines: number[] | null;  // null = use global, number[] = local positions
```

### Actions

| Action | Payload | Effect |
|--------|---------|--------|
| `TOGGLE_GUIDES` | — | Flip `showGuides` |
| `SET_GLOBAL_GUIDES` | `number[]` | Replace `globalGuideLines` |
| `SET_LOCAL_GUIDES` | `{ imageId: string, lines: number[] \| null }` | Set `localGuideLines` for a specific image |

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `G` | Toggle guide lines on/off |

## Rendering Implementation

Guide lines are rendered on the CropPreview canvas during the draw cycle, after the crop image is drawn but before the eraser overlay.

```
Draw order:
1. Crop image (existing)
2. Guide lines (new) ← horizontal lines at percentage-based Y positions
3. Eraser/lasso overlay (existing)
```

The Y position of each line in canvas pixels: `lineY = percentage * displayedImageHeight + imageTopOffset`.

Lines extend from the left edge to the right edge of the displayed crop image (not the full canvas).

## Edge Cases

- **No crop result**: If `cropCanvas` is null (crop cancelled), guide lines are not rendered. The controls remain visible but non-functional.
- **Image rotation**: Guide lines track the displayed image. A 90/270 rotation swaps the effective axis but lines always render as horizontal screen lines at the stored percentage of displayed height.
- **Undo/redo**: Guide line positions are NOT part of the undo/redo history — they are a viewing aid, not an edit operation.
- **Draft persistence**: Guide line positions (both global and per-image local) should be included in draft save/restore.
