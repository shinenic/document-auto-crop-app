"use client";

import { useCallback, useRef, useEffect } from "react";
import { useApp } from "../context/AppContext";
import { EDGE_LABELS, DEFAULT_FILTER_CONFIG } from "../lib/types";
import type { FilterConfig, BinarizeConfig } from "../lib/types";

// --- Icons (14px stroke) ---

const I = ({ d, size = 14 }: { d: string; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>
);

function IconUndo() { return <I d="M3 7v6h6M3 13a9 9 0 1 0 3-7.7L3 7" />; }
function IconRedo() { return <I d="M21 7v6h-6M21 13a9 9 0 1 1-3-7.7L21 7" />; }
function IconRotateCW() { return <I d="M21 2v6h-6M21 8a9 9 0 1 1-3.3-5.3" />; }
function IconRotateCCW() { return <I d="M3 2v6h6M3 8a9 9 0 1 0 3.3-5.3" />; }
function IconEraser() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 20H7L3.7 16.7a1 1 0 0 1 0-1.4L14.3 4.3a1 1 0 0 1 1.4 0L21.7 10.3a1 1 0 0 1 0 1.4L13 20" />
      <path d="m6.5 13.5 5 5" />
    </svg>
  );
}
function IconBrush() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m9.06 11.9 8.07-8.06a2.85 2.85 0 1 1 4.03 4.03l-8.06 8.08" />
      <path d="M7.07 14.94c-1.66 0-3 1.35-3 3.02 0 1.33-2.5 1.52-2 2.02 1.08 1.1 2.49 2.02 4 2.02 2.2 0 4-1.8 4-4.04a3.01 3.01 0 0 0-3-3.02z" />
    </svg>
  );
}
function IconLasso() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M7 22a5 5 0 0 1-2-4" />
      <path d="M3.3 14A6.8 6.8 0 0 1 2 10c0-4.4 4.5-8 10-8s10 3.6 10 8-4.5 8-10 8a12 12 0 0 1-3.7-.5" />
      <circle cx="7" cy="18" r="1" fill="currentColor" />
    </svg>
  );
}
function IconTrash() { return <I d="M3 6h18M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />; }
function IconReset() { return <I d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8M3 3v5h5" />; }
function IconChevron({ open }: { open: boolean }) {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true" className={`transition-transform duration-150 ${open ? "rotate-180" : ""}`}>
      <path d="M2.5 3.5L5 6L7.5 3.5" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function IconCurve() { return <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true"><path d="M3 20Q12 4 21 20" /></svg>; }
function IconLine() { return <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true"><line x1="3" y1="20" x2="21" y2="4" /></svg>; }

// --- Primitives ---

function Btn({
  icon, label, shortcut, onClick, disabled = false, active = false, danger = false, className = "",
}: {
  icon?: React.ReactNode; label: string; shortcut?: string; onClick: () => void;
  disabled?: boolean; active?: boolean; danger?: boolean; className?: string;
}) {
  const base = danger
    ? "bg-[var(--danger-muted)] text-[var(--danger)] hover:bg-[var(--danger)]/20"
    : active
      ? "bg-[var(--accent-muted)] text-[var(--accent)]"
      : "bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]";
  return (
    <button
      className={`flex items-center gap-2 w-full px-2.5 py-[7px] text-[12px] font-medium rounded-md transition-colors disabled:opacity-20 disabled:pointer-events-none ${base} ${className}`}
      onClick={onClick} disabled={disabled}
    >
      {icon && <span className="shrink-0 opacity-70">{icon}</span>}
      <span className="flex-1 text-left">{label}</span>
      {shortcut && <kbd className="text-[10px] text-[var(--text-muted)] font-mono shrink-0 opacity-60">{shortcut}</kbd>}
    </button>
  );
}

function SectionHeader({ title, collapsible, open, onToggle }: {
  title: string; collapsible?: boolean; open?: boolean; onToggle?: () => void;
}) {
  const Tag = collapsible ? "button" : "div";
  return (
    <Tag
      className={`flex items-center justify-between w-full text-[11px] uppercase tracking-[0.06em] text-[var(--text-muted)] mb-1.5 px-0.5 font-semibold ${collapsible ? "cursor-pointer hover:text-[var(--text-secondary)] transition-colors" : ""}`}
      onClick={collapsible ? onToggle : undefined}
      {...(collapsible ? { "aria-expanded": open } : {})}
    >
      <span>{title}</span>
      {collapsible && <IconChevron open={open ?? false} />}
    </Tag>
  );
}

function Slider({
  label, value, min, max, step, disabled, onChange, onPointerDown,
}: {
  label: string; value: number; min: number; max: number; step: number;
  disabled: boolean; onChange: (v: number) => void; onPointerDown: () => void;
}) {
  return (
    <label className="flex flex-col gap-1 px-0.5">
      <div className="flex justify-between text-[11px]">
        <span className="text-[var(--text-muted)]">{label}</span>
        <span className="font-mono text-[var(--text-secondary)]">{value}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value} disabled={disabled}
        className="w-full h-3 disabled:opacity-25" onPointerDown={onPointerDown}
        onChange={(e) => onChange(Number(e.target.value))} />
    </label>
  );
}

function TogglePill({ options, value, onChange, disabled = false }: {
  options: { label: string; value: string; icon?: React.ReactNode }[];
  value: string; onChange: (v: string) => void; disabled?: boolean;
}) {
  return (
    <div role="radiogroup" className="flex rounded-md overflow-hidden border border-[var(--border)]">
      {options.map((opt) => (
        <button key={opt.value}
          role="radio"
          aria-checked={value === opt.value}
          className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-[6px] text-[11px] font-medium transition-colors ${
            value === opt.value
              ? "bg-[var(--accent-muted)] text-[var(--accent)]"
              : "bg-[var(--bg-tertiary)] text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
          } disabled:opacity-25 disabled:pointer-events-none`}
          onClick={() => onChange(opt.value)} disabled={disabled}
        >
          {opt.icon && <span className="opacity-70">{opt.icon}</span>}
          {opt.label}
        </button>
      ))}
    </div>
  );
}

// --- Main ---

export default function ToolPanel({
  eraserActive, onToggleEraser, eraserTool, onSetEraserTool, brushSize, onSetBrushSize,
}: {
  eraserActive: boolean; onToggleEraser: () => void;
  eraserTool: "brush" | "lasso"; onSetEraserTool: (tool: "brush" | "lasso") => void;
  brushSize: number; onSetBrushSize: (size: number) => void;
}) {
  const { state, dispatch } = useApp();
  const sel = state.images.find((img) => img.id === state.selectedImageId);

  const canUndo = (sel?.history.past.length ?? 0) > 0;
  const canRedo = (sel?.history.future.length ?? 0) > 0;
  const hasCrop = sel?.editState != null;
  const id = sel?.id;

  const undo = useCallback(() => { if (id) dispatch({ type: "UNDO", id }); }, [id, dispatch]);
  const redo = useCallback(() => { if (id) dispatch({ type: "REDO", id }); }, [id, dispatch]);

  const rotateCW = useCallback(() => {
    if (!id || !sel?.editState) return;
    dispatch({ type: "PUSH_HISTORY", id });
    const r = sel.editState.rotation;
    dispatch({ type: "SET_EDIT_STATE", id, editState: { ...sel.editState, rotation: ((r + 90) % 360) as 0 | 90 | 180 | 270 } });
  }, [id, sel, dispatch]);

  const rotateCCW = useCallback(() => {
    if (!id || !sel?.editState) return;
    dispatch({ type: "PUSH_HISTORY", id });
    const r = sel.editState.rotation;
    dispatch({ type: "SET_EDIT_STATE", id, editState: { ...sel.editState, rotation: ((r + 270) % 360) as 0 | 90 | 180 | 270 } });
  }, [id, sel, dispatch]);

  const clearEraser = useCallback(() => {
    if (!id || !sel?.editState) return;
    dispatch({ type: "PUSH_HISTORY", id });
    dispatch({ type: "SET_EDIT_STATE", id, editState: { ...sel.editState, eraseMask: null } });
  }, [id, sel, dispatch]);

  const resetToPrediction = useCallback(() => { if (id) dispatch({ type: "RESET_TO_PREDICTION", id }); }, [id, dispatch]);
  const cancelCrop = useCallback(() => { if (id) dispatch({ type: "CANCEL_CROP", id }); }, [id, dispatch]);

  const toggleEdge = useCallback((edgeIdx: number) => {
    if (!id || !sel?.editState) return;
    dispatch({ type: "PUSH_HISTORY", id });
    const edgeFits = sel.editState.edgeFits.map((f) => ({ cp1: [...f.cp1] as [number, number], cp2: [...f.cp2] as [number, number], isArc: f.isArc }));
    const corners = sel.editState.corners;
    const s = corners[edgeIdx], e = corners[(edgeIdx + 1) % 4];
    if (edgeFits[edgeIdx].isArc) {
      edgeFits[edgeIdx].cp1 = [s[0] + (e[0] - s[0]) / 3, s[1] + (e[1] - s[1]) / 3];
      edgeFits[edgeIdx].cp2 = [s[0] + (2 * (e[0] - s[0])) / 3, s[1] + (2 * (e[1] - s[1])) / 3];
      edgeFits[edgeIdx].isArc = false;
    } else {
      const dx = e[0] - s[0], dy = e[1] - s[1], len = Math.hypot(dx, dy);
      const nx = (-dy / len) * len * 0.1, ny = (dx / len) * len * 0.1;
      edgeFits[edgeIdx].cp1 = [s[0] + dx / 3 + nx, s[1] + dy / 3 + ny];
      edgeFits[edgeIdx].cp2 = [s[0] + (2 * dx) / 3 + nx, s[1] + (2 * dy) / 3 + ny];
      edgeFits[edgeIdx].isArc = true;
    }
    dispatch({ type: "SET_EDIT_STATE", id, editState: { ...sel.editState, edgeFits } });
  }, [id, sel, dispatch]);

  const removeEdgeCurve = useCallback((edgeIdx: number) => {
    if (!id || !sel?.editState || !sel.editState.edgeFits[edgeIdx].isArc) return;
    dispatch({ type: "PUSH_HISTORY", id });
    const edgeFits = sel.editState.edgeFits.map((f) => ({ cp1: [...f.cp1] as [number, number], cp2: [...f.cp2] as [number, number], isArc: f.isArc }));
    const corners = sel.editState.corners;
    const s = corners[edgeIdx], e = corners[(edgeIdx + 1) % 4];
    edgeFits[edgeIdx].cp1 = [s[0] + (e[0] - s[0]) / 3, s[1] + (e[1] - s[1]) / 3];
    edgeFits[edgeIdx].cp2 = [s[0] + (2 * (e[0] - s[0])) / 3, s[1] + (2 * (e[1] - s[1])) / 3];
    edgeFits[edgeIdx].isArc = false;
    dispatch({ type: "SET_EDIT_STATE", id, editState: { ...sel.editState, edgeFits } });
  }, [id, sel, dispatch]);

  const filterConfig = sel?.editState?.filterConfig ?? DEFAULT_FILTER_CONFIG;
  const isFilterActive = filterConfig.type === "binarize";

  const setFilterType = useCallback((type: FilterConfig["type"]) => {
    if (!id || !sel?.editState) return;
    dispatch({ type: "PUSH_HISTORY", id });
    dispatch({ type: "SET_EDIT_STATE", id, editState: { ...sel.editState, filterConfig: { ...sel.editState.filterConfig, type } } });
  }, [id, sel, dispatch]);

  const sliderHistoryPushedRef = useRef(false);
  const handleSliderPointerDown = useCallback(() => {
    if (!id || !sel?.editState) return;
    if (!sliderHistoryPushedRef.current) { dispatch({ type: "PUSH_HISTORY", id }); sliderHistoryPushedRef.current = true; }
  }, [id, sel, dispatch]);
  useEffect(() => {
    const up = () => { sliderHistoryPushedRef.current = false; };
    window.addEventListener("pointerup", up);
    return () => window.removeEventListener("pointerup", up);
  }, []);

  const updateBinarizeConfig = useCallback((updates: Partial<BinarizeConfig>) => {
    if (!id || !sel?.editState) return;
    dispatch({ type: "SET_EDIT_STATE", id, editState: {
      ...sel.editState, filterConfig: { ...sel.editState.filterConfig, binarize: { ...sel.editState.filterConfig.binarize, ...updates } },
    }});
  }, [id, sel, dispatch]);

  if (!sel || sel.status !== "ready") {
    return (
      <div className="w-48 flex-shrink-0 bg-[var(--bg-secondary)] border-l border-[var(--border)] panel-inset p-3 flex items-center justify-center">
        <p className="text-[12px] text-[var(--text-muted)]">No image selected</p>
      </div>
    );
  }

  const BEZIER_ORDER = [2, 3, 1, 0];

  return (
    <div className="w-48 flex-shrink-0 bg-[var(--bg-secondary)] border-l border-[var(--border)] panel-inset p-2.5 flex flex-col gap-2.5 overflow-y-auto">

      {/* Undo / Redo */}
      <div className="flex gap-1">
        <Btn icon={<IconUndo />} label="Undo" shortcut="^Z" onClick={undo} disabled={!canUndo} className="flex-1" />
        <Btn icon={<IconRedo />} label="Redo" shortcut="^+Z" onClick={redo} disabled={!canRedo} className="flex-1" />
      </div>

      <div className="h-px bg-[var(--border)]" />

      {/* Rotate */}
      <div>
        <SectionHeader title="Rotate" />
        <div className="flex gap-1">
          <Btn icon={<IconRotateCW />} label="CW" shortcut="R" onClick={rotateCW} disabled={!hasCrop} className="flex-1" />
          <Btn icon={<IconRotateCCW />} label="CCW" shortcut="+R" onClick={rotateCCW} disabled={!hasCrop} className="flex-1" />
        </div>
      </div>

      <div className="h-px bg-[var(--border)]" />

      {/* Filter */}
      <div>
        <SectionHeader title="Filter" />
        <TogglePill
          options={[{ label: "Original", value: "none" }, { label: "B&W", value: "binarize" }]}
          value={filterConfig.type}
          onChange={(v) => setFilterType(v as FilterConfig["type"])}
          disabled={!hasCrop}
        />
        {isFilterActive && (
          <div className="flex flex-col gap-2 mt-2">
            <Slider label="Block Radius" value={filterConfig.binarize.blockRadiusBps} min={20} max={1000} step={10}
              disabled={!hasCrop} onPointerDown={handleSliderPointerDown}
              onChange={(v) => updateBinarizeConfig({ blockRadiusBps: v })} />
            <Slider label="Contrast" value={filterConfig.binarize.contrastOffset} min={-50} max={10} step={1}
              disabled={!hasCrop} onPointerDown={handleSliderPointerDown}
              onChange={(v) => updateBinarizeConfig({ contrastOffset: v })} />
            <Slider label="Upscale %" value={filterConfig.binarize.upsamplingScale} min={100} max={400} step={25}
              disabled={!hasCrop} onPointerDown={handleSliderPointerDown}
              onChange={(v) => updateBinarizeConfig({ upsamplingScale: v })} />
          </div>
        )}
      </div>

      {/* Eraser */}
      {isFilterActive && sel?.filteredCanvas && (
        <>
          <div className="h-px bg-[var(--border)]" />
          <div>
            <SectionHeader title="Eraser" />
            <div className="flex flex-col gap-1">
              <Btn icon={<IconEraser />} label={eraserActive ? "Exit Eraser" : "Eraser"} shortcut="E"
                onClick={onToggleEraser} active={eraserActive} />
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
                    <Slider label="Brush Size" value={brushSize} min={5} max={100} step={1}
                      disabled={false} onPointerDown={() => {}} onChange={onSetBrushSize} />
                  )}
                  {sel?.editState?.eraseMask && (
                    <Btn icon={<IconTrash />} label="Clear All" onClick={clearEraser} danger />
                  )}
                </>
              )}
            </div>
          </div>
        </>
      )}

      <div className="h-px bg-[var(--border)]" />

      {/* Edge Curves */}
      <div>
        <SectionHeader title="Edge Curves" />
        <div className="flex flex-col gap-1">
            {BEZIER_ORDER.map((i) => {
              const label = EDGE_LABELS[i];
              const arc = sel?.editState?.edgeFits[i]?.isArc ?? false;
              return (
                <div key={i} className="flex items-center gap-1.5">
                  <span className="w-12 text-[12px] text-[var(--text-primary)] font-medium shrink-0">{label}</span>
                  <div className="flex flex-1 rounded-md overflow-hidden border border-[var(--border)]">
                    <button
                      className={`flex-1 flex items-center justify-center gap-1 py-1.5 text-[11px] font-medium transition-colors ${
                        !arc ? "bg-[var(--bg-elevated)] text-[var(--text-primary)]" : "bg-[var(--bg-tertiary)] text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
                      } disabled:opacity-20 disabled:pointer-events-none`}
                      onClick={() => { if (arc) removeEdgeCurve(i); }} disabled={!hasCrop || !arc}
                    ><IconLine /> Line</button>
                    <button
                      className={`flex-1 flex items-center justify-center gap-1 py-1.5 text-[11px] font-medium transition-colors ${
                        arc ? "bg-[var(--accent-muted)] text-[var(--accent)]" : "bg-[var(--bg-tertiary)] text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
                      } disabled:opacity-20 disabled:pointer-events-none`}
                      onClick={() => { if (!arc) toggleEdge(i); }} disabled={!hasCrop || arc}
                    ><IconCurve /> Curve</button>
                  </div>
                </div>
              );
            })}
          </div>
      </div>

      {/* Reset */}
      <div>
        <SectionHeader title="Reset" />
        <div className="flex flex-col gap-1">
          <Btn icon={<IconReset />} label="Reset to Prediction" onClick={resetToPrediction} />
          <Btn icon={<IconTrash />} label="Cancel Crop" onClick={cancelCrop} danger />
        </div>
      </div>
    </div>
  );
}
