# Staff Guide Lines + Piecewise Dewarping Design

## Overview

Add user-drawn guide lines to the QuadEditor that trace staff line curvature in sheet music scans. When guide lines are present, the system uses a piecewise Coons patch to straighten those lines in the crop output — each guide line becomes a horizontal line in the result.

## Target Users

Music publishers and engravers processing sheet music scans where the outer quad edges alone cannot correct interior page curvature (e.g., book spine warp affecting staff lines).

## Core Concept

The existing Coons patch uses 4 boundary curves (top, bottom, left, right) to dewarp a document. This works well for simple perspective, but fails when the page has interior curvature (common with book scans). Staff guide lines add intermediate horizontal constraints: the user traces a curved staff line on the source image, and the system ensures that line becomes straight in the output.

## Data Model

### GuideLine type

```typescript
interface GuideLine {
  leftV: number;           // parameter on quad L edge (0=TL, 1=BL)
  rightV: number;          // parameter on quad R edge (0=TR, 1=BR)
  cp1: [number, number];   // Bezier control point 1 (mask space)
  cp2: [number, number];   // Bezier control point 2 (mask space)
}
```

- Endpoints are computed from the quad: `p0 = L(leftV)`, `p3 = R(rightV)`
- On creation, cp1/cp2 initialized at 1/3 and 2/3 along the straight line between endpoints
- Stored sorted by `(leftV + rightV) / 2`

### EditState changes

```typescript
interface EditState {
  corners: [number, number][];
  edgeFits: EdgeFit[];
  guideLines: GuideLine[];    // NEW — sorted by avg v position
  rotation: 0 | 90 | 180 | 270;
  filterConfig: FilterConfig;
  eraseMask: EraseMask | null;
}
```

Guide lines participate in undo/redo (they are part of EditState). Default: `[]`.

## Interaction (QuadEditor)

### Adding a guide line

1. User clicks `+ Guide` button in toolbar (or keyboard shortcut) to enter add mode
2. Click near the quad's left edge → snaps to L edge, determines `leftV`
3. Click near the quad's right edge → snaps to R edge, determines `rightV`, creates guide line (initially straight)
4. Exits add mode automatically after creation

### Editing a guide line

| Action | Behavior |
|--------|----------|
| Drag line body (middle) | Adjusts curvature — cp1 and cp2 move symmetrically perpendicular to the chord |
| Drag endpoint | Slides along the L or R quad edge (adjusts leftV or rightV) |
| Drag cp1 or cp2 | Independent control point adjustment (advanced) |
| Drag line outside quad bounds | Deletes the guide line |
| Select line + Delete/Backspace | Deletes the guide line |

### Visual representation

- **Line color**: `#f59e0b` (amber) — distinct from quad edges (orange) and teal accent
- **Endpoints**: Small circles on L/R edges, draggable
- **Control points**: Small diamonds, connected to endpoints with dashed lines
- **Line**: Cubic Bezier curve, 2px width
- **Hover**: Line thickens to 3px, opacity increases
- **Add mode cursor**: Crosshair

## Piecewise Coons Patch

### Strip decomposition

Guide lines (sorted by avg v) divide the quad into N+1 horizontal strips:

```
Strip 0:  top = quad top edge,      bottom = guideLine[0]
Strip 1:  top = guideLine[0],       bottom = guideLine[1]
...
Strip N:  top = guideLine[N-1],     bottom = quad bottom edge
```

### Per-strip boundaries

Each strip has 4 Bezier boundaries:
- **Top**: Guide line Bezier (or quad top edge for strip 0)
- **Bottom**: Next guide line Bezier (or quad bottom edge for last strip)
- **Left**: Sub-segment of quad L edge, extracted via de Casteljau subdivision
- **Right**: Sub-segment of quad R edge, extracted via de Casteljau subdivision

### Output dimensions

- Total output width/height: Same as original `perspectiveCrop` computation
- Per-strip output height: Proportional to v-span — `stripHeight = totalHeight * (v_bottom - v_top)`
- Strips are stacked vertically to form the complete output

### De Casteljau subdivision

To extract a sub-segment of a Bezier curve (e.g., L edge from v=0.3 to v=0.7):
1. Split the original Bezier at t=0.3 → take the right half
2. Split that result at t = (0.7 - 0.3) / (1 - 0.3) → take the left half
3. Result is a new Bezier with 4 control points representing the sub-segment

### Endpoint snapping

Guide line endpoints are snapped to the L/R quad edges:
- `p0 = L(leftV)` — evaluated on the quad's left edge Bezier (with reversed CPs as in existing code)
- `p3 = R(rightV)` — evaluated on the quad's right edge Bezier

When the user drags a quad corner, guide line endpoints auto-update (they're parameterized by v, not absolute coordinates).

## Implementation — Files to modify

| File | Change |
|------|--------|
| `src/lib/types.ts` | Add `GuideLine` interface; add `guideLines: GuideLine[]` to `EditState` |
| `src/lib/crop.ts` | Export `evalBezier`, `makeArcLengthEval`; add `subdivideBezier()`, `perspectiveCropPiecewise()` |
| `src/context/AppContext.tsx` | Update `cloneEditState`, `editStateFromQuad` to handle `guideLines`; init as `[]` |
| `src/components/QuadEditor.tsx` | Render guide lines; add/drag/delete interaction; add mode state |
| `src/components/EditorScreen.tsx` | `+ Guide` button; switch to piecewise crop when guideLines.length > 0 |

## Edge Cases

- **No guide lines**: Behavior identical to current — single Coons patch
- **Corner drag with guide lines**: Guide line endpoints track L/R edges via v parameter — no manual update needed
- **Straight guide line**: cp1/cp2 at 1/3 and 2/3 → degenerate Bezier = straight line. Piecewise crop still works correctly.
- **Guide lines with cancelled crop**: If `editState` is null, guide lines are irrelevant
- **Very close guide lines**: No minimum spacing enforced. Strips with tiny v-span produce thin output bands — works mathematically but may show sampling artifacts at extreme zoom.

## Future Considerations

- **Approach B (constraint interpolation)**: If piecewise strips show visible seams, switch to a single-patch approach with v-direction constraints. The `GuideLine` data model is compatible with both approaches.
- **Auto-detection**: Future integration with staff line detection (v2 plan) could auto-populate guide lines from detected staff lines.
- **Snap to staff**: Could add a "snap to nearest dark horizontal feature" when placing guide lines.
