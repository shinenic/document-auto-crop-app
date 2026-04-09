"use client";

import { useCallback, useRef, useEffect, useState } from "react";
import TopBar from "./TopBar";
import ImageList from "./ImageList";
import SortModal from "./SortModal";
import QuadEditor from "./QuadEditor";
import CropPreview from "./CropPreview";
import ToolPanel from "./ToolPanel";
import { useApp } from "../context/AppContext";
import { perspectiveCrop, perspectiveCropPiecewise } from "../lib/crop";
import { applyBinarize } from "../lib/binarize";
import type { AppState, DewarpGuide, AlignGuide } from "../lib/types";
import { useKeyboardShortcuts } from "../hooks/useKeyboardShortcuts";

function getSelectedImage(state: AppState) {
  return state.images.find((img) => img.id === state.selectedImageId);
}

export default function EditorScreen() {
  const { state, dispatch } = useApp();
  const prevCropKeyRef = useRef<string | null>(null);
  const isDraggingRef = useRef(false);
  const stateRef = useRef(state);
  stateRef.current = state;

  useKeyboardShortcuts();
  const [sortModalOpen, setSortModalOpen] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(200);
  const resizingRef = useRef(false);

  const [eraserActive, setEraserActive] = useState(false);
  const [eraserTool, setEraserTool] = useState<"brush" | "lasso">("brush");
  const [brushSize, setBrushSize] = useState(50);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [previewBg, setPreviewBg] = useState<"checker" | "black" | "white" | "gray">("checker");
  const [guideAddMode, setGuideAddMode] = useState(false);
  const [guideAddStep, setGuideAddStep] = useState<"left" | "right" | null>(null);
  const [pendingLeftV, setPendingLeftV] = useState<number | null>(null);
  const [pendingP0, setPendingP0] = useState<[number, number] | null>(null);
  const [guidePlacementAxis, setGuidePlacementAxis] = useState<"h" | "v" | null>(null);
  const [alignAddMode, setAlignAddMode] = useState(false);
  const [alignAddStep, setAlignAddStep] = useState<"top" | "bottom" | null>(null);
  const [pendingAlignP0, setPendingAlignP0] = useState<[number, number] | null>(null);

  // Exit eraser mode when switching images or leaving B&W filter
  const currentFilterType = getSelectedImage(state)?.editState?.filterConfig?.type;
  useEffect(() => {
    setEraserActive(false);
    setGuideAddMode(false);
    setGuideAddStep(null);
    setPendingLeftV(null);
    setPendingP0(null);
    setAlignAddMode(false);
    setAlignAddStep(null);
    setPendingAlignP0(null);
  }, [state.selectedImageId, currentFilterType]);

  // Eraser hotkeys: E=toggle, B=brush, L=lasso, [/]=brush size
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;

      const img = getSelectedImage(stateRef.current);
      const isBW = img?.editState?.filterConfig?.type === "binarize" && !!img.filteredCanvas;

      if (e.key === "?" || (e.shiftKey && e.key === "/")) {
        e.preventDefault();
        setShortcutsOpen((v) => !v);
        return;
      }
      if (e.key === "Escape") {
        if (alignAddMode) { setAlignAddMode(false); setAlignAddStep(null); setPendingAlignP0(null); return; }
        if (guideAddMode) { setGuideAddMode(false); setGuideAddStep(null); setPendingLeftV(null); setPendingP0(null); return; }
        if (guidePlacementAxis) { setGuidePlacementAxis(null); return; }
        if (shortcutsOpen) { setShortcutsOpen(false); return; }
        if (eraserActive) { setEraserActive(false); return; }
        return;
      }
      if (e.key.toLowerCase() === "g" && !eraserActive) {
        e.preventDefault();
        dispatch({ type: "TOGGLE_GUIDES" });
        return;
      }
      if (stateRef.current.showGuides && !eraserActive) {
        if (e.key.toLowerCase() === "h") {
          e.preventDefault();
          setGuidePlacementAxis((v) => v === "h" ? null : "h");
          return;
        }
        if (e.key.toLowerCase() === "v") {
          e.preventDefault();
          setGuidePlacementAxis((v) => v === "v" ? null : "v");
          return;
        }
      }
      if (e.key.toLowerCase() === "d" && !eraserActive && img?.editState) {
        e.preventDefault();
        setAlignAddMode(false); setAlignAddStep(null); setPendingAlignP0(null);
        setGuideAddMode((v) => {
          if (!v) { setGuideAddStep("left"); }
          else { setGuideAddStep(null); setPendingLeftV(null); setPendingP0(null); }
          return !v;
        });
        return;
      }
      if (e.key.toLowerCase() === "a" && !eraserActive && img?.editState) {
        e.preventDefault();
        setGuideAddMode(false); setGuideAddStep(null); setPendingLeftV(null); setPendingP0(null);
        setAlignAddMode((v) => {
          if (!v) { setAlignAddStep("top"); }
          else { setAlignAddStep(null); setPendingAlignP0(null); }
          return !v;
        });
        return;
      }
      if (e.key.toLowerCase() === "e" && isBW) {
        e.preventDefault();
        setEraserActive((v) => !v);
        return;
      }
      if (eraserActive) {
        if (e.key.toLowerCase() === "b") {
          e.preventDefault();
          setEraserTool("brush");
          return;
        }
        if (e.key.toLowerCase() === "l") {
          e.preventDefault();
          setEraserTool("lasso");
          return;
        }
        if (e.key === "[") {
          e.preventDefault();
          setBrushSize((s) => Math.max(5, s - 5));
          return;
        }
        if (e.key === "]") {
          e.preventDefault();
          setBrushSize((s) => Math.min(150, s + 5));
          return;
        }
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [eraserActive, shortcutsOpen, guideAddMode, guidePlacementAxis, alignAddMode, dispatch]);

  const selectedImage = getSelectedImage(state);

  // Clear eraseMask when filteredCanvas dimensions change (crop geometry changed)
  useEffect(() => {
    if (!selectedImage?.editState?.eraseMask || !selectedImage.filteredCanvas) return;
    const mask = selectedImage.editState.eraseMask;
    const fc = selectedImage.filteredCanvas;
    if (mask.width !== fc.width || mask.height !== fc.height) {
      dispatch({
        type: "SET_EDIT_STATE",
        id: selectedImage.id,
        editState: { ...selectedImage.editState, eraseMask: null },
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedImage?.filteredCanvas]);

  // Recompute full-res crop when editState changes (undo/redo/rotate/toggle)
  const cropKey = selectedImage?.editState
    ? JSON.stringify({
        corners: selectedImage.editState.corners,
        edgeFits: selectedImage.editState.edgeFits,
        dewarpGuides: selectedImage.editState.dewarpGuides,
        alignGuides: selectedImage.editState.alignGuides,
      })
    : null;

  useEffect(() => {
    if (isDraggingRef.current) return;
    if (!selectedImage?.editState || !selectedImage.originalCanvas) {
      prevCropKeyRef.current = null; // reset so next editState triggers recompute
      return;
    }
    if (cropKey === prevCropKeyRef.current) return;
    prevCropKeyRef.current = cropKey;

    const quadResult = {
      corners: selectedImage.editState.corners,
      edges: selectedImage.initialQuad?.edges ?? [],
      edgeFits: selectedImage.editState.edgeFits,
    };

    const dg = selectedImage.editState.dewarpGuides;
    const ag = selectedImage.editState.alignGuides;
    const cropCanvas = (dg.length > 0 || ag.length > 0)
      ? perspectiveCropPiecewise(
          selectedImage.originalCanvas,
          quadResult,
          dg,
          ag,
          selectedImage.maskWidth,
          selectedImage.maskHeight,
        )
      : perspectiveCrop(
          selectedImage.originalCanvas,
          quadResult,
          selectedImage.maskWidth,
          selectedImage.maskHeight,
        );

    dispatch({
      type: "UPDATE_IMAGE",
      id: selectedImage.id,
      updates: { cropCanvas },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cropKey, state.selectedImageId]);

  // Compute filteredCanvas when cropCanvas or filterConfig changes
  const filterKey = selectedImage?.editState?.filterConfig
    ? JSON.stringify(selectedImage.editState.filterConfig)
    : null;

  useEffect(() => {
    if (!selectedImage?.cropCanvas || !selectedImage.editState) return;

    const { filterConfig } = selectedImage.editState;
    const imageId = selectedImage.id;
    const cropCanvas = selectedImage.cropCanvas;

    // If filter is none, clear filteredCanvas
    if (filterConfig.type === "none") {
      if (selectedImage.filteredCanvas) {
        dispatch({
          type: "UPDATE_IMAGE",
          id: imageId,
          updates: { filteredCanvas: null },
        });
      }
      return;
    }

    // Debounce: wait 200ms before computing
    let cancelled = false;
    const timer = setTimeout(() => {
      applyBinarize(cropCanvas, filterConfig.binarize).then(
        (filteredCanvas) => {
          if (!cancelled) {
            dispatch({
              type: "UPDATE_IMAGE",
              id: imageId,
              updates: { filteredCanvas },
            });
          }
        },
        (err) => {
          if (!cancelled) {
            console.error("Binarize filter failed:", err);
          }
        },
      );
    }, 200);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterKey, selectedImage?.cropCanvas, state.selectedImageId]);

  // Recompute filteredCanvas for non-selected images after batch filter.
  // Processes sequentially to avoid flooding the binarize worker.
  useEffect(() => {
    let cancelled = false;

    async function processBatch() {
      for (const img of state.images) {
        if (cancelled) break;
        if (img.id === state.selectedImageId) continue;
        if (!img.cropCanvas || !img.editState) continue;

        const { filterConfig } = img.editState;
        if (filterConfig.type === "none") {
          if (img.filteredCanvas) {
            dispatch({
              type: "UPDATE_IMAGE",
              id: img.id,
              updates: { filteredCanvas: null },
            });
          }
          continue;
        }

        if (!img.filteredCanvas) {
          try {
            const filteredCanvas = await applyBinarize(img.cropCanvas, filterConfig.binarize);
            if (!cancelled) {
              dispatch({
                type: "UPDATE_IMAGE",
                id: img.id,
                updates: { filteredCanvas },
              });
            }
          } catch (err) {
            if (!cancelled) {
              console.error("Batch binarize failed for", img.id, err);
            }
          }
        }
      }
    }

    processBatch();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.images.map((img) => img.editState?.filterConfig?.type).join(",")]);

  const handleDragStart = useCallback(() => {
    isDraggingRef.current = true;
  }, []);

  // Full-res crop after drag ends
  const handleDragEnd = useCallback(() => {
    isDraggingRef.current = false;
    const img = getSelectedImage(stateRef.current);
    if (!img?.editState || !img.originalCanvas) return;

    const quadResult = {
      corners: img.editState.corners,
      edges: img.initialQuad?.edges ?? [],
      edgeFits: img.editState.edgeFits,
    };

    const dg = img.editState.dewarpGuides;
    const ag = img.editState.alignGuides;
    const cropCanvas = (dg.length > 0 || ag.length > 0)
      ? perspectiveCropPiecewise(
          img.originalCanvas,
          quadResult,
          dg,
          ag,
          img.maskWidth,
          img.maskHeight,
        )
      : perspectiveCrop(
          img.originalCanvas,
          quadResult,
          img.maskWidth,
          img.maskHeight,
        );

    // Update prevCropKey so the useEffect doesn't double-compute
    prevCropKeyRef.current = JSON.stringify({
      corners: img.editState.corners,
      edgeFits: img.editState.edgeFits,
      dewarpGuides: img.editState.dewarpGuides,
      alignGuides: img.editState.alignGuides,
    });

    dispatch({
      type: "UPDATE_IMAGE",
      id: img.id,
      updates: { cropCanvas },
    });
  }, [dispatch]);

  const handleGuideAddClick = useCallback((mx: number, my: number) => {
    const img = getSelectedImage(stateRef.current);
    if (!img?.editState) return;
    const es = img.editState;

    if (guideAddStep === null || guideAddStep === "left") {
      // First click: place left endpoint (p0) at clicked position
      setPendingLeftV(mx); // reuse state for storing p0.x temporarily
      setPendingP0([mx, my]);
      setGuideAddStep("right");
    } else if (guideAddStep === "right" && pendingP0) {
      // Second click: place right endpoint (p3) and create dewarp guide
      const p0 = pendingP0;
      const p3: [number, number] = [mx, my];

      const newGuide: DewarpGuide = {
        p0,
        p3,
        cp1: [p0[0] + (p3[0] - p0[0]) / 3, p0[1] + (p3[1] - p0[1]) / 3],
        cp2: [p0[0] + 2 * (p3[0] - p0[0]) / 3, p0[1] + 2 * (p3[1] - p0[1]) / 3],
      };

      dispatch({ type: "PUSH_HISTORY", id: img.id });
      const dewarpGuides = [...es.dewarpGuides, newGuide].sort(
        (a, b) => (a.p0[1] + a.p3[1]) / 2 - (b.p0[1] + b.p3[1]) / 2,
      );
      dispatch({ type: "SET_EDIT_STATE", id: img.id, editState: { ...es, dewarpGuides } });

      setGuideAddStep(null);
      setPendingP0(null);
      setPendingLeftV(null);
      setGuideAddMode(false);
    }
  }, [guideAddStep, pendingP0, dispatch]);

  const handleClearGuides = useCallback(() => {
    const img = getSelectedImage(stateRef.current);
    if (!img?.editState || img.editState.dewarpGuides.length === 0) return;
    dispatch({ type: "PUSH_HISTORY", id: img.id });
    dispatch({ type: "SET_EDIT_STATE", id: img.id, editState: { ...img.editState, dewarpGuides: [] } });
  }, [dispatch]);

  const handleAlignAddClick = useCallback((mx: number, my: number) => {
    const img = getSelectedImage(stateRef.current);
    if (!img?.editState) return;
    const es = img.editState;

    if (alignAddStep === null || alignAddStep === "top") {
      setPendingAlignP0([mx, my]);
      setAlignAddStep("bottom");
    } else if (alignAddStep === "bottom" && pendingAlignP0) {
      const p0 = pendingAlignP0;
      const p1: [number, number] = [mx, my];
      const newGuide: AlignGuide = { p0, p1 };
      dispatch({ type: "PUSH_HISTORY", id: img.id });
      const alignGuides = [...es.alignGuides, newGuide].sort(
        (a, b) => (a.p0[0] + a.p1[0]) / 2 - (b.p0[0] + b.p1[0]) / 2,
      );
      dispatch({ type: "SET_EDIT_STATE", id: img.id, editState: { ...es, alignGuides } });
      setAlignAddStep(null);
      setPendingAlignP0(null);
      setAlignAddMode(false);
    }
  }, [alignAddStep, pendingAlignP0, dispatch]);

  const handleClearAlignGuides = useCallback(() => {
    const img = getSelectedImage(stateRef.current);
    if (!img?.editState || img.editState.alignGuides.length === 0) return;
    dispatch({ type: "PUSH_HISTORY", id: img.id });
    dispatch({ type: "SET_EDIT_STATE", id: img.id, editState: { ...img.editState, alignGuides: [] } });
  }, [dispatch]);

  const handleResizePointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    resizingRef.current = true;
    const startX = e.clientX;
    const startW = sidebarWidth;

    const onMove = (ev: PointerEvent) => {
      const delta = ev.clientX - startX;
      setSidebarWidth(Math.max(100, Math.min(480, startW + delta)));
    };

    const onUp = () => {
      resizingRef.current = false;
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }, [sidebarWidth]);

  return (
    <div className="h-dvh flex flex-col">
      <TopBar
        onManageImages={() => setSortModalOpen(true)}
        previewBg={previewBg}
        onSetPreviewBg={setPreviewBg}
        onUndo={() => { if (selectedImage) dispatch({ type: "UNDO", id: selectedImage.id }); }}
        onRedo={() => { if (selectedImage) dispatch({ type: "REDO", id: selectedImage.id }); }}
        onRotateCW={() => {
          if (selectedImage?.editState) {
            dispatch({ type: "PUSH_HISTORY", id: selectedImage.id });
            dispatch({ type: "SET_EDIT_STATE", id: selectedImage.id, editState: {
              ...selectedImage.editState,
              rotation: ((selectedImage.editState.rotation + 90) % 360) as 0 | 90 | 180 | 270,
            }});
          }
        }}
        onRotateCCW={() => {
          if (selectedImage?.editState) {
            dispatch({ type: "PUSH_HISTORY", id: selectedImage.id });
            dispatch({ type: "SET_EDIT_STATE", id: selectedImage.id, editState: {
              ...selectedImage.editState,
              rotation: ((selectedImage.editState.rotation + 270) % 360) as 0 | 90 | 180 | 270,
            }});
          }
        }}
        onResetPrediction={() => { if (selectedImage) dispatch({ type: "RESET_TO_PREDICTION", id: selectedImage.id }); }}
        onCancelCrop={() => { if (selectedImage) dispatch({ type: "CANCEL_CROP", id: selectedImage.id }); }}
        onToggleShortcuts={() => setShortcutsOpen(v => !v)}
        onNavigate={(dir) => {
          const idx = state.images.findIndex(img => img.id === state.selectedImageId);
          const newIdx = dir === "up" ? Math.max(0, idx - 1) : Math.min(state.images.length - 1, idx + 1);
          if (newIdx !== idx) dispatch({ type: "SELECT_IMAGE", id: state.images[newIdx].id });
        }}
      />
      <div className="flex-1 flex min-h-0">
        <div className="flex flex-col flex-shrink-0 relative border-r border-[var(--border)] bg-[var(--bg-secondary)]" style={{ width: sidebarWidth }}>
          <ImageList />
          {/* Resize handle */}
          <div
            className="absolute top-0 right-0 w-2 h-full cursor-col-resize hover:bg-[var(--accent)]/20 active:bg-[var(--accent)]/40 transition-colors z-10 flex items-center justify-center group"
            onPointerDown={handleResizePointerDown}
          >
            <div className="w-0.5 h-8 rounded-full bg-[var(--text-muted)]/30 group-hover:bg-[var(--accent)]/60 transition-colors" />
          </div>
        </div>
        <div className="flex-1 flex min-w-0">
          <div className="flex-1 border-r border-[var(--border)] flex flex-col min-w-0">
            <div className="px-3 py-1.5 border-b border-[var(--border)] bg-[var(--bg-secondary)]">
              <h4 className="text-[11px] uppercase tracking-[0.06em] text-[var(--text-muted)] font-semibold">
                Editor
              </h4>
            </div>
            <QuadEditor
              onDragStart={handleDragStart}
              onDragEnd={handleDragEnd}
              guideAddMode={guideAddMode || alignAddMode}
              guideAddStep={guideAddMode ? guideAddStep : alignAddStep}
              pendingLeftV={pendingLeftV}
              onGuideAddClick={alignAddMode ? handleAlignAddClick : handleGuideAddClick}
            />
          </div>
          <div className="flex-1 flex flex-col min-w-0">
            <div className="px-3 py-1.5 border-b border-[var(--border)] bg-[var(--bg-secondary)] flex items-center justify-between">
              <h4 className="text-[11px] uppercase tracking-[0.06em] text-[var(--text-muted)] font-semibold">
                Preview
              </h4>
              {state.showGuides && (
                <div className="flex items-center gap-1.5">
                  <button
                    className={`px-1.5 py-0.5 text-[9px] rounded border transition-colors ${
                      guidePlacementAxis === "h"
                        ? "bg-[var(--accent-muted)] text-[var(--accent)] border-[var(--accent)]"
                        : "bg-[var(--bg-tertiary)] text-[var(--text-muted)] hover:text-[var(--text-secondary)] border-[var(--border)]"
                    }`}
                    onClick={() => setGuidePlacementAxis(guidePlacementAxis === "h" ? null : "h")}
                    title="Click to place a horizontal guide line"
                  >
                    + Horizontal <kbd className="ml-1 text-[8px] font-mono opacity-50">H</kbd>
                  </button>
                  <button
                    className={`px-1.5 py-0.5 text-[9px] rounded border transition-colors ${
                      guidePlacementAxis === "v"
                        ? "bg-[var(--accent-muted)] text-[var(--accent)] border-[var(--accent)]"
                        : "bg-[var(--bg-tertiary)] text-[var(--text-muted)] hover:text-[var(--text-secondary)] border-[var(--border)]"
                    }`}
                    onClick={() => setGuidePlacementAxis(guidePlacementAxis === "v" ? null : "v")}
                    title="Click to place a vertical guide line"
                  >
                    + Vertical <kbd className="ml-1 text-[8px] font-mono opacity-50">V</kbd>
                  </button>
                  <span className="text-[9px] font-mono text-[var(--accent)] min-w-[1ch] text-center">
                    {getSelectedImage(state)?.editState?.guideLines?.length ?? 0}
                  </span>
                  <button
                    className="px-1.5 py-0.5 text-[9px] rounded text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors"
                    onClick={() => {
                      const img = getSelectedImage(state);
                      if (!img?.editState) return;
                      dispatch({ type: "PUSH_HISTORY", id: img.id });
                      dispatch({ type: "SET_GUIDE_LINES", id: img.id, guideLines: [] });
                    }}
                    title="Clear all guide lines"
                  >
                    Clear
                  </button>
                </div>
              )}
            </div>
            <CropPreview
              eraserActive={eraserActive}
              eraserTool={eraserTool}
              brushSize={brushSize}
              previewBg={previewBg}
              guidePlacementAxis={guidePlacementAxis}
              onGuidePlaced={() => setGuidePlacementAxis(null)}
            />
          </div>
        </div>
        <ToolPanel
          eraserActive={eraserActive}
          onToggleEraser={() => setEraserActive((v) => !v)}
          eraserTool={eraserTool}
          onSetEraserTool={setEraserTool}
          brushSize={brushSize}
          onSetBrushSize={setBrushSize}
          guideAddMode={guideAddMode}
          onToggleGuideAdd={() => {
            setGuideAddMode((v) => !v);
            if (!guideAddMode) setGuideAddStep("left");
            else { setGuideAddStep(null); setPendingLeftV(null); setPendingP0(null); }
          }}
          onClearGuides={handleClearGuides}
          alignAddMode={alignAddMode}
          onToggleAlignAdd={() => {
            setGuideAddMode(false); setGuideAddStep(null); setPendingLeftV(null); setPendingP0(null);
            setAlignAddMode((v) => !v);
            if (!alignAddMode) setAlignAddStep("top");
            else { setAlignAddStep(null); setPendingAlignP0(null); }
          }}
          onClearAlignGuides={handleClearAlignGuides}
        />
      </div>
      {sortModalOpen && (
        <SortModal onClose={() => setSortModalOpen(false)} />
      )}

      {/* Keyboard shortcuts overlay */}
      {shortcutsOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShortcutsOpen(false)}>
          <div role="dialog" aria-modal="true" aria-labelledby="shortcuts-title" className="bg-[var(--bg-secondary)] border border-[var(--border)] rounded-xl shadow-2xl p-5 max-w-sm w-full mx-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 id="shortcuts-title" className="text-[13px] font-semibold text-[var(--text-primary)]">Keyboard Shortcuts</h3>
              <kbd className="text-[10px] text-[var(--text-muted)] font-mono bg-[var(--bg-tertiary)] px-1.5 py-0.5 rounded">?</kbd>
            </div>
            {[
              { group: "File", keys: [["Ctrl+S", "Save Draft"], ["Ctrl+Shift+S", "Save Draft As"], ["Ctrl+O", "Open Draft"], ["Ctrl+E", "Export current JPEG"]] },
              { group: "Navigation", keys: [["Arrow Up / Down", "Previous / Next image"]] },
              { group: "Editing", keys: [["Ctrl+Z", "Undo"], ["Ctrl+Shift+Z", "Redo"], ["R", "Rotate 90° CW"], ["Shift+R", "Rotate 90° CCW"]] },
              { group: "Eraser", keys: [["E", "Toggle eraser mode"], ["B", "Brush tool"], ["L", "Lasso tool"], ["[ / ]", "Brush size -/+"]] },
              { group: "Guides", keys: [["G", "Toggle guide lines"], ["H", "Place horizontal line"], ["V", "Place vertical line"], ["Right-click", "Remove line"]] },
              { group: "Dewarp", keys: [["D", "Toggle dewarp guide add mode"], ["A", "Toggle align guide add mode"], ["Esc", "Cancel placement"], ["Delete / Backspace", "Remove selected guide"]] },
            ].map(({ group, keys }) => (
              <div key={group} className="mb-3 last:mb-0">
                <h4 className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] mb-1.5 font-semibold">{group}</h4>
                <div className="flex flex-col gap-1">
                  {keys.map(([key, desc]) => (
                    <div key={key} className="flex items-center justify-between">
                      <span className="text-[12px] text-[var(--text-secondary)]">{desc}</span>
                      <kbd className="text-[10px] text-[var(--text-muted)] font-mono bg-[var(--bg-tertiary)] px-1.5 py-0.5 rounded ml-3 shrink-0">{key}</kbd>
                    </div>
                  ))}
                </div>
              </div>
            ))}
            <p className="text-[10px] text-[var(--text-muted)] mt-3 pt-3 border-t border-[var(--border)]">Press <kbd className="font-mono">?</kbd> or <kbd className="font-mono">Esc</kbd> to close</p>
          </div>
        </div>
      )}
    </div>
  );
}
