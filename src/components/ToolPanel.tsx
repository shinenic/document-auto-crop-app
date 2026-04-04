"use client";

import { useCallback, useRef, useEffect } from "react";
import { useApp } from "../context/AppContext";
import { EDGE_LABELS, DEFAULT_FILTER_CONFIG } from "../lib/types";
import type { FilterConfig, BinarizeConfig } from "../lib/types";

function ToolButton({
  label,
  onClick,
  disabled = false,
  variant = "default",
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  variant?: "default" | "danger" | "accent";
}) {
  const colors = {
    default:
      "bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]",
    danger:
      "bg-[var(--bg-tertiary)] text-[var(--danger)] hover:bg-red-950/30",
    accent:
      "bg-[var(--accent-muted)] text-[var(--accent)] hover:bg-[var(--accent)]/20",
  };

  return (
    <button
      className={`w-full px-3 py-2 text-xs font-medium rounded-lg transition-colors disabled:opacity-30 disabled:pointer-events-none ${colors[variant]}`}
      onClick={onClick}
      disabled={disabled}
    >
      {label}
    </button>
  );
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  disabled,
  onChange,
  onPointerDown,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  disabled: boolean;
  onChange: (v: number) => void;
  onPointerDown: () => void;
}) {
  return (
    <label className="flex flex-col gap-1">
      <div className="flex justify-between text-[10px] text-[var(--text-muted)]">
        <span>{label}</span>
        <span className="font-mono">{value}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        className="w-full h-1 accent-[var(--accent)] disabled:opacity-30"
        onPointerDown={onPointerDown}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  );
}

export default function ToolPanel() {
  const { state, dispatch } = useApp();
  const selectedImage = state.images.find(
    (img) => img.id === state.selectedImageId,
  );

  const canUndo = (selectedImage?.history.past.length ?? 0) > 0;
  const canRedo = (selectedImage?.history.future.length ?? 0) > 0;
  const hasCrop = selectedImage?.editState != null;
  const id = selectedImage?.id;

  const undo = useCallback(() => {
    if (id) dispatch({ type: "UNDO", id });
  }, [id, dispatch]);

  const redo = useCallback(() => {
    if (id) dispatch({ type: "REDO", id });
  }, [id, dispatch]);

  const rotateCW = useCallback(() => {
    if (!id || !selectedImage?.editState) return;
    dispatch({ type: "PUSH_HISTORY", id });
    const r = selectedImage.editState.rotation;
    dispatch({
      type: "SET_EDIT_STATE",
      id,
      editState: { ...selectedImage.editState, rotation: ((r + 90) % 360) as 0 | 90 | 180 | 270 },
    });
  }, [id, selectedImage, dispatch]);

  const rotateCCW = useCallback(() => {
    if (!id || !selectedImage?.editState) return;
    dispatch({ type: "PUSH_HISTORY", id });
    const r = selectedImage.editState.rotation;
    dispatch({
      type: "SET_EDIT_STATE",
      id,
      editState: { ...selectedImage.editState, rotation: ((r + 270) % 360) as 0 | 90 | 180 | 270 },
    });
  }, [id, selectedImage, dispatch]);

  const batchRotateCW = useCallback(() => {
    dispatch({ type: "BATCH_ROTATE", rotation: 90 });
  }, [dispatch]);

  const batchRotateCCW = useCallback(() => {
    dispatch({ type: "BATCH_ROTATE", rotation: 270 });
  }, [dispatch]);

  const batchFilter = useCallback(() => {
    if (!selectedImage?.editState) return;
    dispatch({
      type: "BATCH_SET_FILTER",
      filterConfig: selectedImage.editState.filterConfig,
    });
  }, [selectedImage, dispatch]);

  const otherImageCount = state.images.filter(
    (img) => img.id !== selectedImage?.id && img.editState != null,
  ).length;

  const resetToPrediction = useCallback(() => {
    if (id) dispatch({ type: "RESET_TO_PREDICTION", id });
  }, [id, dispatch]);

  const cancelCrop = useCallback(() => {
    if (id) dispatch({ type: "CANCEL_CROP", id });
  }, [id, dispatch]);

  const toggleEdge = useCallback(
    (edgeIdx: number) => {
      if (!id || !selectedImage?.editState) return;
      dispatch({ type: "PUSH_HISTORY", id });

      const edgeFits = selectedImage.editState.edgeFits.map((f) => ({
        cp1: [...f.cp1] as [number, number],
        cp2: [...f.cp2] as [number, number],
        isArc: f.isArc,
      }));
      const corners = selectedImage.editState.corners;
      const s = corners[edgeIdx];
      const e = corners[(edgeIdx + 1) % 4];

      if (edgeFits[edgeIdx].isArc) {
        edgeFits[edgeIdx].cp1 = [s[0] + (e[0] - s[0]) / 3, s[1] + (e[1] - s[1]) / 3];
        edgeFits[edgeIdx].cp2 = [s[0] + (2 * (e[0] - s[0])) / 3, s[1] + (2 * (e[1] - s[1])) / 3];
        edgeFits[edgeIdx].isArc = false;
      } else {
        const dx = e[0] - s[0], dy = e[1] - s[1];
        const len = Math.hypot(dx, dy);
        const nx = (-dy / len) * len * 0.1, ny = (dx / len) * len * 0.1;
        edgeFits[edgeIdx].cp1 = [s[0] + dx / 3 + nx, s[1] + dy / 3 + ny];
        edgeFits[edgeIdx].cp2 = [s[0] + (2 * dx) / 3 + nx, s[1] + (2 * dy) / 3 + ny];
        edgeFits[edgeIdx].isArc = true;
      }

      dispatch({
        type: "SET_EDIT_STATE",
        id,
        editState: { ...selectedImage.editState, edgeFits },
      });
    },
    [id, selectedImage, dispatch],
  );

  const removeEdgeCurve = useCallback(
    (edgeIdx: number) => {
      if (!id || !selectedImage?.editState) return;
      if (!selectedImage.editState.edgeFits[edgeIdx].isArc) return;

      dispatch({ type: "PUSH_HISTORY", id });
      const edgeFits = selectedImage.editState.edgeFits.map((f) => ({
        cp1: [...f.cp1] as [number, number],
        cp2: [...f.cp2] as [number, number],
        isArc: f.isArc,
      }));
      const corners = selectedImage.editState.corners;
      const s = corners[edgeIdx];
      const e = corners[(edgeIdx + 1) % 4];
      edgeFits[edgeIdx].cp1 = [s[0] + (e[0] - s[0]) / 3, s[1] + (e[1] - s[1]) / 3];
      edgeFits[edgeIdx].cp2 = [s[0] + (2 * (e[0] - s[0])) / 3, s[1] + (2 * (e[1] - s[1])) / 3];
      edgeFits[edgeIdx].isArc = false;

      dispatch({
        type: "SET_EDIT_STATE",
        id,
        editState: { ...selectedImage.editState, edgeFits },
      });
    },
    [id, selectedImage, dispatch],
  );

  const filterConfig = selectedImage?.editState?.filterConfig ?? DEFAULT_FILTER_CONFIG;
  const isFilterActive = filterConfig.type === "binarize";

  const setFilterType = useCallback(
    (type: FilterConfig["type"]) => {
      if (!id || !selectedImage?.editState) return;
      dispatch({ type: "PUSH_HISTORY", id });
      dispatch({
        type: "SET_EDIT_STATE",
        id,
        editState: {
          ...selectedImage.editState,
          filterConfig: { ...selectedImage.editState.filterConfig, type },
        },
      });
    },
    [id, selectedImage, dispatch],
  );

  // Track whether we've already pushed history for the current slider drag
  const sliderHistoryPushedRef = useRef(false);

  const handleSliderPointerDown = useCallback(() => {
    if (!id || !selectedImage?.editState) return;
    if (!sliderHistoryPushedRef.current) {
      dispatch({ type: "PUSH_HISTORY", id });
      sliderHistoryPushedRef.current = true;
    }
  }, [id, selectedImage, dispatch]);

  // Reset the flag when pointer is released anywhere
  useEffect(() => {
    const handlePointerUp = () => {
      sliderHistoryPushedRef.current = false;
    };
    window.addEventListener("pointerup", handlePointerUp);
    return () => window.removeEventListener("pointerup", handlePointerUp);
  }, []);

  const updateBinarizeConfig = useCallback(
    (updates: Partial<BinarizeConfig>) => {
      if (!id || !selectedImage?.editState) return;
      dispatch({
        type: "SET_EDIT_STATE",
        id,
        editState: {
          ...selectedImage.editState,
          filterConfig: {
            ...selectedImage.editState.filterConfig,
            binarize: {
              ...selectedImage.editState.filterConfig.binarize,
              ...updates,
            },
          },
        },
      });
    },
    [id, selectedImage, dispatch],
  );

  if (!selectedImage || selectedImage.status !== "ready") {
    return (
      <div className="w-44 flex-shrink-0 bg-[var(--bg-secondary)] border-l border-[var(--border)] p-3">
        <p className="text-xs text-[var(--text-muted)]">No image selected</p>
      </div>
    );
  }

  return (
    <div className="w-44 flex-shrink-0 bg-[var(--bg-secondary)] border-l border-[var(--border)] p-3 flex flex-col gap-4 overflow-y-auto">
      {/* History */}
      <div>
        <h4 className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] mb-2">History</h4>
        <div className="flex flex-col gap-1">
          <ToolButton label="Undo (Ctrl+Z)" onClick={undo} disabled={!canUndo} />
          <ToolButton label="Redo (Ctrl+Shift+Z)" onClick={redo} disabled={!canRedo} />
        </div>
      </div>

      {/* Rotation */}
      <div>
        <h4 className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] mb-2">Rotation</h4>
        <div className="flex flex-col gap-1">
          <ToolButton label="Rotate 90° CW (R)" onClick={rotateCW} disabled={!hasCrop} />
          <ToolButton label="Rotate 90° CCW (Shift+R)" onClick={rotateCCW} disabled={!hasCrop} />
        </div>
      </div>

      {otherImageCount > 0 && hasCrop && (
        <div className="flex gap-1 -mt-3">
          <button
            className="flex-1 px-2 py-1 text-[10px] text-[var(--text-muted)] hover:text-[var(--accent)] transition-colors"
            onClick={batchRotateCW}
            title="Rotate all images 90° clockwise"
          >
            Rotate All CW
          </button>
          <button
            className="flex-1 px-2 py-1 text-[10px] text-[var(--text-muted)] hover:text-[var(--accent)] transition-colors"
            onClick={batchRotateCCW}
            title="Rotate all images 90° counter-clockwise"
          >
            Rotate All CCW
          </button>
        </div>
      )}

      {/* Filter */}
      <div>
        <h4 className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] mb-2">Filter</h4>
        <div className="flex gap-1 mb-2">
          <button
            className={`flex-1 px-2 py-1.5 text-[10px] font-medium rounded-lg transition-colors ${
              !isFilterActive
                ? "bg-[var(--accent-muted)] text-[var(--accent)]"
                : "bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)]"
            } disabled:opacity-30 disabled:pointer-events-none`}
            onClick={() => setFilterType("none")}
            disabled={!hasCrop}
          >
            None
          </button>
          <button
            className={`flex-1 px-2 py-1.5 text-[10px] font-medium rounded-lg transition-colors ${
              isFilterActive
                ? "bg-[var(--accent-muted)] text-[var(--accent)]"
                : "bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)]"
            } disabled:opacity-30 disabled:pointer-events-none`}
            onClick={() => setFilterType("binarize")}
            disabled={!hasCrop}
          >
            B&W
          </button>
        </div>
        {isFilterActive && (
          <div className="flex flex-col gap-2">
            <Slider
              label="Block Radius"
              value={filterConfig.binarize.blockRadiusBps}
              min={50}
              max={1000}
              step={10}
              disabled={!hasCrop}
              onPointerDown={handleSliderPointerDown}
              onChange={(v) => updateBinarizeConfig({ blockRadiusBps: v })}
            />
            <Slider
              label="Contrast"
              value={filterConfig.binarize.contrastOffset}
              min={-50}
              max={10}
              step={1}
              disabled={!hasCrop}
              onPointerDown={handleSliderPointerDown}
              onChange={(v) => updateBinarizeConfig({ contrastOffset: v })}
            />
            <Slider
              label="Upscale %"
              value={filterConfig.binarize.upsamplingScale}
              min={100}
              max={400}
              step={25}
              disabled={!hasCrop}
              onPointerDown={handleSliderPointerDown}
              onChange={(v) => updateBinarizeConfig({ upsamplingScale: v })}
            />
          </div>
        )}
      </div>

      {otherImageCount > 0 && hasCrop && (
        <div className="-mt-3">
          <button
            className="w-full px-2 py-1 text-[10px] text-[var(--text-muted)] hover:text-[var(--accent)] transition-colors"
            onClick={batchFilter}
            title="Apply current filter settings to all images"
          >
            Apply Filter to All ({otherImageCount})
          </button>
        </div>
      )}

      {/* Reset */}
      <div>
        <h4 className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] mb-2">Reset</h4>
        <div className="flex flex-col gap-1">
          <ToolButton label="Reset to Prediction" onClick={resetToPrediction} />
          <ToolButton label="Cancel Crop" onClick={cancelCrop} variant="danger" />
        </div>
      </div>

      {/* Bezier CPs */}
      <div>
        <h4 className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] mb-2">Bezier CPs</h4>
        <div className="flex flex-col gap-1">
          {EDGE_LABELS.map((label, i) => {
            const arc = selectedImage?.editState?.edgeFits[i]?.isArc ?? false;
            return (
              <div key={i} className="flex items-center gap-1">
                <span className={`flex-1 text-xs ${arc ? "text-[var(--accent)]" : "text-[var(--text-secondary)]"}`}>
                  {label}
                </span>
                <button
                  className="w-7 h-7 flex items-center justify-center text-sm font-bold rounded-lg bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)] transition-colors disabled:opacity-30 disabled:pointer-events-none"
                  onClick={() => {
                    if (!arc) toggleEdge(i);
                  }}
                  disabled={!hasCrop || arc}
                  title={`Add curve to ${label.toLowerCase()} edge`}
                >
                  +
                </button>
                <button
                  className="w-7 h-7 flex items-center justify-center text-sm font-bold rounded-lg bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)] transition-colors disabled:opacity-30 disabled:pointer-events-none"
                  onClick={() => removeEdgeCurve(i)}
                  disabled={!hasCrop || !arc}
                  title={`Remove curve from ${label.toLowerCase()} edge`}
                >
                  −
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
