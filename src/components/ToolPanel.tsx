"use client";

import { useCallback, useRef, useEffect } from "react";
import { useApp } from "../context/AppContext";
import { EDGE_LABELS, DEFAULT_FILTER_CONFIG } from "../lib/types";
import type { FilterConfig, BinarizeConfig } from "../lib/types";

// --- SVG Icons (inline, 16x16) ---

function IconUndo() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 7v6h6" /><path d="M3 13a9 9 0 1 0 3-7.7L3 7" />
    </svg>
  );
}

function IconRedo() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 7v6h-6" /><path d="M21 13a9 9 0 1 1-3-7.7L21 7" />
    </svg>
  );
}

function IconRotateCW() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 2v6h-6" /><path d="M21 8A9 9 0 1 0 6.7 3.3L3 7" style={{ display: "none" }} /><path d="M15 2l6 6-6 6" style={{ display: "none" }} /><path d="M21 8a9 9 0 1 1-3.3-5.3" />
    </svg>
  );
}

function IconRotateCCW() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 2v6h6" /><path d="M3 8a9 9 0 1 0 3.3-5.3" />
    </svg>
  );
}

function IconEraser() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21" /><path d="M22 21H7" /><path d="m5 11 9 9" />
    </svg>
  );
}

function IconBrush() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m9.06 11.9 8.07-8.06a2.85 2.85 0 1 1 4.03 4.03l-8.06 8.08" /><path d="M7.07 14.94c-1.66 0-3 1.35-3 3.02 0 1.33-2.5 1.52-2 2.02 1.08 1.1 2.49 2.02 4 2.02 2.2 0 4-1.8 4-4.04a3.01 3.01 0 0 0-3-3.02z" />
    </svg>
  );
}

function IconLasso() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M7 22a5 5 0 0 1-2-4" /><path d="M3.3 14A6.8 6.8 0 0 1 2 10c0-4.4 4.5-8 10-8s10 3.6 10 8-4.5 8-10 8a12 12 0 0 1-3.7-.5" />
      <circle cx="7" cy="18" r="1" fill="currentColor" />
    </svg>
  );
}

function IconTrash() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 6h18" /><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" /><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
    </svg>
  );
}

function IconReset() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" /><path d="M3 3v5h5" />
    </svg>
  );
}

function IconCurve() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
      <path d="M3 20Q12 4 21 20" />
    </svg>
  );
}

function IconLine() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
      <line x1="3" y1="20" x2="21" y2="4" />
    </svg>
  );
}

// --- Reusable Components ---

function ToolBtn({
  icon,
  label,
  shortcut,
  onClick,
  disabled = false,
  active = false,
  danger = false,
  className = "",
}: {
  icon?: React.ReactNode;
  label: string;
  shortcut?: string;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
  danger?: boolean;
  className?: string;
}) {
  const base = danger
    ? "bg-[var(--danger-muted)] text-[var(--danger)] hover:bg-[var(--danger)]/20"
    : active
      ? "bg-[var(--accent-muted)] text-[var(--accent)]"
      : "bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]";

  return (
    <button
      className={`flex items-center gap-2 w-full px-2.5 py-1.5 text-[11px] font-medium rounded-md transition-colors disabled:opacity-25 disabled:pointer-events-none ${base} ${className}`}
      onClick={onClick}
      disabled={disabled}
    >
      {icon && <span className="shrink-0 opacity-80">{icon}</span>}
      <span className="flex-1 text-left">{label}</span>
      {shortcut && (
        <span className="text-[9px] text-[var(--text-muted)] font-mono shrink-0">{shortcut}</span>
      )}
    </button>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h4 className="text-[9px] uppercase tracking-[0.1em] text-[var(--text-muted)] mb-1.5 px-0.5 font-semibold">{title}</h4>
      {children}
    </div>
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
    <label className="flex flex-col gap-1 px-0.5">
      <div className="flex justify-between text-[10px]">
        <span className="text-[var(--text-muted)]">{label}</span>
        <span className="font-mono text-[var(--text-secondary)]">{value}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        className="w-full h-3 disabled:opacity-30"
        onPointerDown={onPointerDown}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  );
}

function TogglePill({
  options,
  value,
  onChange,
  disabled = false,
}: {
  options: { label: string; value: string; icon?: React.ReactNode }[];
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex rounded-md overflow-hidden border border-[var(--border)]">
      {options.map((opt) => (
        <button
          key={opt.value}
          className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 text-[10px] font-medium transition-colors ${
            value === opt.value
              ? "bg-[var(--accent-muted)] text-[var(--accent)]"
              : "bg-[var(--bg-tertiary)] text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
          } disabled:opacity-30 disabled:pointer-events-none`}
          onClick={() => onChange(opt.value)}
          disabled={disabled}
        >
          {opt.icon && <span className="opacity-80">{opt.icon}</span>}
          {opt.label}
        </button>
      ))}
    </div>
  );
}

// --- Main Component ---

export default function ToolPanel({
  eraserActive,
  onToggleEraser,
  eraserTool,
  onSetEraserTool,
  brushSize,
  onSetBrushSize,
}: {
  eraserActive: boolean;
  onToggleEraser: () => void;
  eraserTool: "brush" | "lasso";
  onSetEraserTool: (tool: "brush" | "lasso") => void;
  brushSize: number;
  onSetBrushSize: (size: number) => void;
}) {
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
    if (eraserActive) onToggleEraser();
    dispatch({
      type: "BATCH_SET_FILTER",
      filterConfig: selectedImage.editState.filterConfig,
    });
  }, [selectedImage, dispatch, eraserActive, onToggleEraser]);

  const clearEraser = useCallback(() => {
    if (!id || !selectedImage?.editState) return;
    dispatch({ type: "PUSH_HISTORY", id });
    dispatch({
      type: "SET_EDIT_STATE",
      id,
      editState: { ...selectedImage.editState, eraseMask: null },
    });
  }, [id, selectedImage, dispatch]);

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

  const sliderHistoryPushedRef = useRef(false);

  const handleSliderPointerDown = useCallback(() => {
    if (!id || !selectedImage?.editState) return;
    if (!sliderHistoryPushedRef.current) {
      dispatch({ type: "PUSH_HISTORY", id });
      sliderHistoryPushedRef.current = true;
    }
  }, [id, selectedImage, dispatch]);

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
      <div className="w-48 flex-shrink-0 bg-[var(--bg-secondary)] border-l border-[var(--border)] p-3">
        <p className="text-xs text-[var(--text-muted)]">No image selected</p>
      </div>
    );
  }

  // Bezier CPs: reversed order (Bottom, Left, Right, Top → visually bottom-up)
  const BEZIER_ORDER = [2, 3, 1, 0]; // Bottom, Left, Right, Top

  return (
    <div className="w-48 flex-shrink-0 bg-[var(--bg-secondary)] border-l border-[var(--border)] p-2.5 flex flex-col gap-3 overflow-y-auto">

      {/* History — compact row */}
      <div className="flex gap-1">
        <ToolBtn icon={<IconUndo />} label="Undo" shortcut="^Z" onClick={undo} disabled={!canUndo} className="flex-1" />
        <ToolBtn icon={<IconRedo />} label="Redo" shortcut="^+Z" onClick={redo} disabled={!canRedo} className="flex-1" />
      </div>

      <div className="h-px bg-[var(--border)]" />

      {/* Rotation */}
      <Section title="Rotate">
        <div className="flex gap-1">
          <ToolBtn icon={<IconRotateCW />} label="CW" shortcut="R" onClick={rotateCW} disabled={!hasCrop} className="flex-1" />
          <ToolBtn icon={<IconRotateCCW />} label="CCW" shortcut="+R" onClick={rotateCCW} disabled={!hasCrop} className="flex-1" />
        </div>
        {otherImageCount > 0 && hasCrop && (
          <div className="flex gap-1 mt-1">
            <button
              className="flex-1 px-2 py-1 text-[9px] text-[var(--text-muted)] hover:text-[var(--accent)] transition-colors rounded"
              onClick={batchRotateCW}
              title="Rotate all images 90° clockwise"
            >
              All CW
            </button>
            <button
              className="flex-1 px-2 py-1 text-[9px] text-[var(--text-muted)] hover:text-[var(--accent)] transition-colors rounded"
              onClick={batchRotateCCW}
              title="Rotate all images 90° counter-clockwise"
            >
              All CCW
            </button>
          </div>
        )}
      </Section>

      <div className="h-px bg-[var(--border)]" />

      {/* Edge Curves — reversed: Bottom → Left → Right → Top */}
      <Section title="Edge Curves">
        <div className="flex flex-col gap-0.5">
          {BEZIER_ORDER.map((i) => {
            const label = EDGE_LABELS[i];
            const arc = selectedImage?.editState?.edgeFits[i]?.isArc ?? false;
            return (
              <div key={i} className="flex items-center gap-1 group">
                <span className={`flex-1 text-[11px] ${arc ? "text-[var(--accent)]" : "text-[var(--text-secondary)]"}`}>
                  {label}
                </span>
                <button
                  className={`w-7 h-6 flex items-center justify-center rounded transition-colors ${
                    arc
                      ? "bg-[var(--accent-muted)] text-[var(--accent)]"
                      : "bg-[var(--bg-tertiary)] text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
                  } disabled:opacity-25 disabled:pointer-events-none`}
                  onClick={() => { if (!arc) toggleEdge(i); }}
                  disabled={!hasCrop || arc}
                  title={`Add curve to ${label.toLowerCase()} edge`}
                >
                  <IconCurve />
                </button>
                <button
                  className={`w-7 h-6 flex items-center justify-center rounded transition-colors ${
                    !arc
                      ? "bg-[var(--bg-tertiary)] text-[var(--text-muted)]"
                      : "bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                  } disabled:opacity-25 disabled:pointer-events-none`}
                  onClick={() => removeEdgeCurve(i)}
                  disabled={!hasCrop || !arc}
                  title={`Straighten ${label.toLowerCase()} edge`}
                >
                  <IconLine />
                </button>
              </div>
            );
          })}
        </div>
      </Section>

      <div className="h-px bg-[var(--border)]" />

      {/* Filter */}
      <Section title="Filter">
        <TogglePill
          options={[
            { label: "Original", value: "none" },
            { label: "B&W", value: "binarize" },
          ]}
          value={filterConfig.type}
          onChange={(v) => setFilterType(v as FilterConfig["type"])}
          disabled={!hasCrop}
        />
        {isFilterActive && (
          <div className="flex flex-col gap-2 mt-2">
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
        {otherImageCount > 0 && hasCrop && (
          <button
            className="w-full mt-1 px-2 py-1 text-[9px] text-[var(--text-muted)] hover:text-[var(--accent)] transition-colors rounded"
            onClick={batchFilter}
            title="Apply current filter settings to all images"
          >
            Apply to All ({otherImageCount})
          </button>
        )}
      </Section>

      {/* Eraser */}
      {isFilterActive && selectedImage?.filteredCanvas && (
        <>
          <div className="h-px bg-[var(--border)]" />
          <Section title="Eraser">
            <div className="flex flex-col gap-1">
              <ToolBtn
                icon={<IconEraser />}
                label={eraserActive ? "Exit Eraser" : "Eraser"}
                shortcut="E"
                onClick={onToggleEraser}
                active={eraserActive}
              />
              {eraserActive && (
                <>
                  <TogglePill
                    options={[
                      { label: "Brush", value: "brush", icon: <IconBrush /> },
                      { label: "Lasso", value: "lasso", icon: <IconLasso /> },
                    ]}
                    value={eraserTool}
                    onChange={(v) => onSetEraserTool(v as "brush" | "lasso")}
                  />
                  {eraserTool === "brush" && (
                    <Slider
                      label="Brush Size"
                      value={brushSize}
                      min={5}
                      max={100}
                      step={1}
                      disabled={false}
                      onPointerDown={() => {}}
                      onChange={onSetBrushSize}
                    />
                  )}
                  {selectedImage?.editState?.eraseMask && (
                    <ToolBtn
                      icon={<IconTrash />}
                      label="Clear All"
                      onClick={clearEraser}
                      danger
                    />
                  )}
                </>
              )}
            </div>
          </Section>
        </>
      )}

      <div className="h-px bg-[var(--border)]" />

      {/* Reset */}
      <Section title="Reset">
        <div className="flex flex-col gap-1">
          <ToolBtn icon={<IconReset />} label="Reset to Prediction" onClick={resetToPrediction} />
          <ToolBtn icon={<IconTrash />} label="Cancel Crop" onClick={cancelCrop} danger />
        </div>
      </Section>
    </div>
  );
}
