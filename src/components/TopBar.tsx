"use client";

import { useRef, useCallback, useState, useEffect } from "react";
import JSZip from "jszip";
import { useApp } from "../context/AppContext";
import { useDraft } from "../context/DraftContext";
import { processImages } from "./imageProcessor";
import { rotateCanvas } from "../lib/crop";
import { exportPdf } from "../lib/pdfExport";
import { applyEraseMask } from "../lib/eraser";
import { PDF_PAGE_SIZES, detectBestPageSize, DEFAULT_BINARIZE_CONFIG } from "../lib/types";
import type { PdfPageSize, FilterConfig, BinarizeConfig } from "../lib/types";

// --- Dropdown Menu Component ---

function DropdownMenu({
  label,
  children,
  disabled = false,
  accent = false,
  menuTrigger = false,
  minWidth = 220,
}: {
  label: string;
  children: React.ReactNode;
  disabled?: boolean;
  accent?: boolean;
  menuTrigger?: boolean;
  minWidth?: number;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
      return;
    }
    if (!menuRef.current) return;
    const items = Array.from(menuRef.current.querySelectorAll<HTMLElement>('button:not(:disabled), select, input'));
    if (items.length === 0) return;
    const idx = items.indexOf(document.activeElement as HTMLElement);
    if (e.key === "ArrowDown") {
      e.preventDefault();
      items[idx < items.length - 1 ? idx + 1 : 0]?.focus();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      items[idx > 0 ? idx - 1 : items.length - 1]?.focus();
    }
  }, []);

  const btnClass = menuTrigger
    ? "px-2.5 py-1 text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] rounded transition-colors"
    : accent
      ? "px-3 py-1.5 text-xs font-medium rounded-lg bg-[var(--accent)] text-[var(--bg-primary)] hover:bg-[var(--accent-hover)] transition-colors disabled:opacity-40 flex items-center gap-1"
      : "px-3 py-1.5 text-xs font-medium rounded-lg bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)] transition-colors disabled:opacity-40 flex items-center gap-1";

  const alignClass = menuTrigger ? "left-0" : "right-0";

  return (
    <div ref={ref} className="relative">
      <button
        className={btnClass}
        onClick={() => setOpen((v) => !v)}
        disabled={disabled}
        aria-haspopup="true"
        aria-expanded={open}
      >
        {label}
        {!menuTrigger && (
          <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor" aria-hidden="true" className={`transition-transform ${open ? "rotate-180" : ""}`}>
            <path d="M2 3.5L5 6.5L8 3.5" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </button>
      {open && (
        <div ref={menuRef} role="menu" className={`absolute ${alignClass} top-full mt-1 bg-[var(--bg-elevated)] border border-[var(--border)] rounded-lg shadow-xl z-50 py-1 overflow-hidden`} style={{ minWidth }}
          onKeyDown={handleKeyDown}
          onClick={(e) => {
            // Auto-close only when a MenuItem (role="menuitem") is clicked
            const t = e.target as HTMLElement;
            if (t.closest("[role='menuitem']:not(:disabled)")) {
              setTimeout(() => setOpen(false), 100);
            }
          }}
        >
          {children}
        </div>
      )}
    </div>
  );
}

function MenuItem({
  label,
  onClick,
  disabled = false,
  shortcut,
  checked,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  shortcut?: string;
  checked?: boolean;
}) {
  return (
    <button
      role="menuitem"
      className="w-full flex items-center justify-between px-3 py-2 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)] transition-colors disabled:opacity-30 disabled:pointer-events-none text-left"
      onClick={onClick}
      disabled={disabled}
    >
      <span className="flex items-center gap-2">
        {checked !== undefined && (
          <span className="w-3 text-center text-[10px]">{checked ? "\u2713" : ""}</span>
        )}
        {label}
      </span>
      {shortcut && <span className="text-[10px] text-[var(--text-muted)] font-mono ml-3">{shortcut}</span>}
    </button>
  );
}

function MenuDivider() {
  return <div className="h-px bg-[var(--border)] my-1" />;
}

function MenuLabel({ children }: { children: React.ReactNode }) {
  return <div className="px-3 py-1 text-[10px] uppercase tracking-wider text-[var(--text-muted)] font-semibold">{children}</div>;
}

// --- Main Component ---

type PreviewBg = "checker" | "black" | "white" | "gray";

export default function TopBar({
  onManageImages,
  previewBg,
  onSetPreviewBg,
  onUndo,
  onRedo,
  onRotateCW,
  onRotateCCW,
  onResetPrediction,
  onCancelCrop,
  onToggleShortcuts,
  onNavigate,
}: {
  onManageImages?: () => void;
  previewBg?: PreviewBg;
  onSetPreviewBg?: (bg: PreviewBg) => void;
  onUndo?: () => void;
  onRedo?: () => void;
  onRotateCW?: () => void;
  onRotateCCW?: () => void;
  onResetPrediction?: () => void;
  onCancelCrop?: () => void;
  onToggleShortcuts?: () => void;
  onNavigate?: (dir: "up" | "down") => void;
}) {
  const { state, dispatch } = useApp();
  const draft = useDraft();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [exporting, setExporting] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [pdfPageSize, setPdfPageSize] = useState<PdfPageSize>(PDF_PAGE_SIZES[0]);
  const [customW, setCustomW] = useState(210);
  const [customH, setCustomH] = useState(297);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((msg: string) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast(msg);
    toastTimer.current = setTimeout(() => setToast(null), 3000);
  }, []);

  const handleAddImages = useCallback(
    (files: FileList | File[]) => {
      const imageFiles = Array.from(files).filter((f) =>
        f.type.startsWith("image/"),
      );
      if (imageFiles.length > 0) {
        processImages(imageFiles, dispatch, state.selectedImageId);
      }
    },
    [dispatch, state.selectedImageId],
  );

  const handleExport = useCallback(() => {
    const selectedImage = state.images.find(
      (img) => img.id === state.selectedImageId,
    );
    if (!selectedImage?.cropCanvas) return;

    const filterType = selectedImage.editState?.filterConfig?.type ?? "none";
    let sourceCanvas =
      filterType !== "none" && selectedImage.filteredCanvas
        ? selectedImage.filteredCanvas
        : selectedImage.cropCanvas;

    const eraseMask = selectedImage.editState?.eraseMask;
    if (eraseMask && sourceCanvas && filterType !== "none") {
      sourceCanvas = applyEraseMask(sourceCanvas, eraseMask);
    }

    const rotation = selectedImage.editState?.rotation ?? 0;
    const final = rotateCanvas(sourceCanvas, rotation);

    final.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.download = `cropped-${selectedImage.fileName.replace(/\.[^.]+$/, "")}.jpg`;
      link.href = url;
      link.click();
      URL.revokeObjectURL(url);
      const kb = Math.round(blob.size / 1024);
      showToast(`JPEG exported (${kb} KB)`);
    }, "image/jpeg", 0.92);
  }, [state.images, state.selectedImageId, showToast]);

  const handleExportAll = useCallback(async () => {
    setExporting(true);
    try {
      const zip = new JSZip();

      for (const img of state.images) {
        if (!img.cropCanvas) continue;

        const filterType = img.editState?.filterConfig?.type ?? "none";
        let sourceCanvas =
          filterType !== "none" && img.filteredCanvas
            ? img.filteredCanvas
            : img.cropCanvas;

        const eraseMask = img.editState?.eraseMask;
        if (eraseMask && sourceCanvas && filterType !== "none") {
          sourceCanvas = applyEraseMask(sourceCanvas, eraseMask);
        }

        const rotation = img.editState?.rotation ?? 0;
        const final = rotateCanvas(sourceCanvas, rotation);

        const blob = await new Promise<Blob | null>((resolve) => {
          final.toBlob((b) => resolve(b), "image/jpeg", 0.92);
        });
        if (!blob) continue;

        const name = `cropped-${img.fileName.replace(/\.[^.]+$/, "")}.jpg`;
        zip.file(name, blob);
      }

      const zipBlob = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(zipBlob);
      const link = document.createElement("a");
      link.download = "cropped-images.zip";
      link.href = url;
      link.click();
      URL.revokeObjectURL(url);
      const count = zip.filter(() => true).length;
      const mb = (zipBlob.size / (1024 * 1024)).toFixed(1);
      showToast(`ZIP exported (${count} images, ${mb} MB)`);
    } finally {
      setExporting(false);
    }
  }, [state.images, showToast]);

  const handleExportPdf = useCallback(async () => {
    setExportingPdf(true);
    try {
      let pageSize: { widthMm: number; heightMm: number } | undefined;
      if (pdfPageSize.widthMm === 0) {
        const readyImgs = state.images
          .filter((img) => img.status === "ready" && img.cropCanvas)
          .map((img) => ({ width: img.cropCanvas!.width, height: img.cropCanvas!.height }));
        const detected = detectBestPageSize(readyImgs);
        pageSize = { widthMm: detected.widthMm, heightMm: detected.heightMm };
      } else if (pdfPageSize.widthMm === -2) {
        pageSize = { widthMm: customW, heightMm: customH };
      } else if (pdfPageSize.widthMm > 0) {
        pageSize = { widthMm: pdfPageSize.widthMm, heightMm: pdfPageSize.heightMm };
      }

      const pdfBlob = await exportPdf(state.images, pageSize);
      const url = URL.createObjectURL(pdfBlob);
      const link = document.createElement("a");
      link.download = "cropped-images.pdf";
      link.href = url;
      link.click();
      URL.revokeObjectURL(url);
      const pages = state.images.filter((img) => img.status === "ready" && img.cropCanvas && img.editState).length;
      const mb = (pdfBlob.size / (1024 * 1024)).toFixed(1);
      showToast(`PDF exported (${pages} page${pages !== 1 ? "s" : ""}, ${mb} MB)`);
    } catch (err) {
      console.error("PDF export failed:", err);
      showToast("PDF export failed");
    } finally {
      setExportingPdf(false);
    }
  }, [state.images, pdfPageSize, customW, customH, showToast]);

  const selectedImage = state.images.find((img) => img.id === state.selectedImageId);
  const hasEditState = !!selectedImage?.editState;
  const hasPast = (selectedImage?.history?.past?.length ?? 0) > 0;
  const hasFuture = (selectedImage?.history?.future?.length ?? 0) > 0;
  const multipleEditable = state.images.filter((img) => img.editState != null).length > 1;

  const handleBatchRotateCW = useCallback(() => {
    dispatch({ type: "BATCH_ROTATE", rotation: 90 });
  }, [dispatch]);

  const handleBatchRotateCCW = useCallback(() => {
    dispatch({ type: "BATCH_ROTATE", rotation: 270 });
  }, [dispatch]);

  const [batchFilterType, setBatchFilterType] = useState<FilterConfig["type"]>("none");
  const [batchBinarize, setBatchBinarize] = useState<BinarizeConfig>({ ...DEFAULT_BINARIZE_CONFIG });

  const handleBatchFilter = useCallback(() => {
    const filterConfig: FilterConfig = {
      type: batchFilterType,
      binarize: { ...batchBinarize },
    };
    dispatch({ type: "BATCH_SET_FILTER", filterConfig });
  }, [batchFilterType, batchBinarize, dispatch]);

  const readyCount = state.images.filter(
    (img) => img.status === "ready" && img.cropCanvas,
  ).length;

  const noImages = state.images.length === 0;

  return (
    <div className="h-11 flex items-center justify-between px-3 bg-[var(--bg-secondary)] border-b border-[var(--border)] relative">
      {/* Left side: title + menus */}
      <div className="flex items-center gap-1">
        <span className="text-sm font-semibold text-[var(--text-primary)] mr-2">
          Document Auto-Crop
        </span>

        {/* File Menu */}
        <DropdownMenu label="File" menuTrigger minWidth={260}>
          <MenuItem
            label="Open Draft Folder..."
            onClick={() => draft.openDraft()}
            disabled={!draft.isSupported}
            shortcut="\u2318O"
          />
          <MenuItem
            label="Save Draft"
            onClick={() => draft.save()}
            disabled={noImages || !draft.isSupported}
            shortcut="\u2318S"
          />
          <MenuItem
            label="Save Draft As..."
            onClick={() => draft.saveAs()}
            disabled={noImages || !draft.isSupported}
            shortcut="\u21E7\u2318S"
          />
          <MenuDivider />
          <MenuItem
            label="Add Images..."
            onClick={() => fileInputRef.current?.click()}
          />
          <MenuItem
            label="Manage Images"
            onClick={() => onManageImages?.()}
            disabled={noImages}
          />
          <MenuDivider />
          <MenuLabel>Export</MenuLabel>
          <MenuItem
            label="Download Current as JPEG"
            onClick={handleExport}
            disabled={!state.selectedImageId}
            shortcut="\u2318E"
          />
          <MenuItem
            label={exporting ? "Exporting ZIP..." : `Download All as ZIP (${readyCount})`}
            onClick={handleExportAll}
            disabled={readyCount === 0 || exporting}
          />
          <MenuDivider />
          <MenuLabel>PDF Export</MenuLabel>
          <div className="px-3 py-1.5">
            <select
              className="w-full px-2 py-1.5 text-xs rounded-md bg-[var(--bg-tertiary)] text-[var(--text-secondary)] border border-[var(--border)] cursor-pointer"
              value={pdfPageSize.label}
              onChange={(e) => {
                const found = PDF_PAGE_SIZES.find((s) => s.label === e.target.value);
                if (found) setPdfPageSize(found);
              }}
            >
              {PDF_PAGE_SIZES.map((s) => (
                <option key={s.label} value={s.label}>
                  {s.label}{s.widthMm > 0 ? ` (${s.widthMm}\u00D7${s.heightMm})` : ""}
                </option>
              ))}
            </select>
            {pdfPageSize.widthMm === -2 && (
              <div className="flex items-center gap-1 mt-1.5">
                <input
                  type="number"
                  className="flex-1 px-1.5 py-1 text-xs rounded-md bg-[var(--bg-tertiary)] text-[var(--text-secondary)] border border-[var(--border)] text-center"
                  value={customW}
                  min={50}
                  max={1000}
                  onChange={(e) => setCustomW(Number(e.target.value) || 210)}
                />
                <span className="text-[10px] text-[var(--text-muted)]">\u00D7</span>
                <input
                  type="number"
                  className="flex-1 px-1.5 py-1 text-xs rounded-md bg-[var(--bg-tertiary)] text-[var(--text-secondary)] border border-[var(--border)] text-center"
                  value={customH}
                  min={50}
                  max={1000}
                  onChange={(e) => setCustomH(Number(e.target.value) || 297)}
                />
                <span className="text-[10px] text-[var(--text-muted)]">mm</span>
              </div>
            )}
          </div>
          <MenuItem
            label={exportingPdf ? "Exporting PDF..." : `Download PDF (${readyCount})`}
            onClick={handleExportPdf}
            disabled={readyCount === 0 || exportingPdf}
          />
        </DropdownMenu>

        {/* Edit Menu */}
        <DropdownMenu label="Edit" menuTrigger minWidth={240}>
          <MenuItem
            label="Undo"
            onClick={() => onUndo?.()}
            disabled={!hasPast}
            shortcut="\u2318Z"
          />
          <MenuItem
            label="Redo"
            onClick={() => onRedo?.()}
            disabled={!hasFuture}
            shortcut="\u21E7\u2318Z"
          />
          <MenuDivider />
          <MenuItem
            label="Rotate 90\u00B0 CW"
            onClick={() => onRotateCW?.()}
            disabled={!hasEditState}
            shortcut="R"
          />
          <MenuItem
            label="Rotate 90\u00B0 CCW"
            onClick={() => onRotateCCW?.()}
            disabled={!hasEditState}
            shortcut="\u21E7R"
          />
          <MenuItem
            label="Reset to Detection"
            onClick={() => onResetPrediction?.()}
            disabled={!hasEditState}
          />
          <MenuItem
            label="Cancel Crop"
            onClick={() => onCancelCrop?.()}
            disabled={!hasEditState}
          />
          {multipleEditable && (
            <>
              <MenuDivider />
              <MenuLabel>Batch</MenuLabel>
              <MenuItem label="Rotate All CW" onClick={handleBatchRotateCW} />
              <MenuItem label="Rotate All CCW" onClick={handleBatchRotateCCW} />
              <MenuDivider />
              <MenuLabel>Apply Filter to All</MenuLabel>
              <div className="px-3 py-1.5 flex flex-col gap-2">
                {/* Filter type toggle */}
                <div className="flex rounded-md overflow-hidden border border-[var(--border)]">
                  <button
                    className={`flex-1 px-2 py-1.5 text-[11px] font-medium transition-colors ${
                      batchFilterType === "none"
                        ? "bg-[var(--bg-tertiary)] text-[var(--text-primary)]"
                        : "text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
                    }`}
                    onClick={() => setBatchFilterType("none")}
                  >
                    Original
                  </button>
                  <button
                    className={`flex-1 px-2 py-1.5 text-[11px] font-medium transition-colors ${
                      batchFilterType === "binarize"
                        ? "bg-[var(--accent-muted)] text-[var(--accent)]"
                        : "text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
                    }`}
                    onClick={() => setBatchFilterType("binarize")}
                  >
                    B&W
                  </button>
                </div>
                {/* B&W parameters */}
                {batchFilterType === "binarize" && (
                  <div className="flex flex-col gap-1.5">
                    <label className="flex flex-col gap-0.5">
                      <div className="flex justify-between text-[11px]">
                        <span className="text-[var(--text-muted)]">Block Radius</span>
                        <span className="font-mono text-[var(--text-secondary)]">{batchBinarize.blockRadiusBps}</span>
                      </div>
                      <input type="range" min={20} max={1000} step={10} value={batchBinarize.blockRadiusBps}
                        className="w-full h-3"
                        onChange={(e) => setBatchBinarize((prev) => ({ ...prev, blockRadiusBps: Number(e.target.value) }))}
                      />
                    </label>
                    <label className="flex flex-col gap-0.5">
                      <div className="flex justify-between text-[11px]">
                        <span className="text-[var(--text-muted)]">Contrast</span>
                        <span className="font-mono text-[var(--text-secondary)]">{batchBinarize.contrastOffset}</span>
                      </div>
                      <input type="range" min={-50} max={10} step={1} value={batchBinarize.contrastOffset}
                        className="w-full h-3"
                        onChange={(e) => setBatchBinarize((prev) => ({ ...prev, contrastOffset: Number(e.target.value) }))}
                      />
                    </label>
                    <label className="flex flex-col gap-0.5">
                      <div className="flex justify-between text-[11px]">
                        <span className="text-[var(--text-muted)]">Upscale %</span>
                        <span className="font-mono text-[var(--text-secondary)]">{batchBinarize.upsamplingScale}</span>
                      </div>
                      <input type="range" min={100} max={400} step={25} value={batchBinarize.upsamplingScale}
                        className="w-full h-3"
                        onChange={(e) => setBatchBinarize((prev) => ({ ...prev, upsamplingScale: Number(e.target.value) }))}
                      />
                    </label>
                  </div>
                )}
                <button
                  className="w-full px-3 py-1.5 text-xs font-medium rounded-md bg-[var(--accent)] text-[var(--bg-primary)] hover:bg-[var(--accent-hover)] transition-colors"
                  onClick={handleBatchFilter}
                >
                  Apply to All Images
                </button>
              </div>
            </>
          )}
        </DropdownMenu>

        {/* View Menu */}
        <DropdownMenu label="View" menuTrigger minWidth={220}>
          <MenuLabel>Preview Background</MenuLabel>
          {([
            { value: "checker" as PreviewBg, label: "Checker" },
            { value: "black" as PreviewBg, label: "Black" },
            { value: "gray" as PreviewBg, label: "Gray" },
            { value: "white" as PreviewBg, label: "White" },
          ]).map((opt) => (
            <MenuItem
              key={opt.value}
              label={opt.label}
              onClick={() => onSetPreviewBg?.(opt.value)}
              checked={previewBg === opt.value}
            />
          ))}
          <MenuDivider />
          <MenuItem
            label="Show Mask Overlay"
            onClick={() => dispatch({ type: "TOGGLE_MASK" })}
            checked={state.showMask}
          />
          <MenuDivider />
          <MenuItem
            label="Previous Image"
            onClick={() => onNavigate?.("up")}
            shortcut="\u2191"
          />
          <MenuItem
            label="Next Image"
            onClick={() => onNavigate?.("down")}
            shortcut="\u2193"
          />
          <MenuDivider />
          <MenuItem
            label="Keyboard Shortcuts"
            onClick={() => onToggleShortcuts?.()}
            shortcut="?"
          />
        </DropdownMenu>
      </div>

      {/* Right side: draft status + image count + BG swatches */}
      <div className="flex items-center gap-3">
        {/* Draft status indicator */}
        {draft.dirHandle && (
          <div className="flex items-center gap-1.5 text-[11px] text-[var(--text-muted)]">
            {draft.isSaving ? (
              <>
                <svg className="w-3 h-3 animate-spin" viewBox="0 0 16 16" fill="none">
                  <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="2" strokeDasharray="28" strokeDashoffset="8" strokeLinecap="round" />
                </svg>
                <span>Saving...</span>
              </>
            ) : draft.lastSavedAt ? (
              <span>Saved {new Date(draft.lastSavedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
            ) : null}
            {draft.hasUnsavedChanges && !draft.isSaving && (
              <div className="w-1.5 h-1.5 rounded-full bg-[var(--accent)]" title="Unsaved changes" />
            )}
          </div>
        )}

        <span className="text-xs text-[var(--text-muted)]">
          {state.images.length} image
          {state.images.length !== 1 ? "s" : ""}
        </span>

        {/* Preview Background swatches */}
        {onSetPreviewBg && (
          <div className="flex items-center gap-1">
            <span className="text-[10px] text-[var(--text-muted)]">BG</span>
            {([
              { value: "checker" as PreviewBg, title: "Checkerboard", style: { backgroundImage: "linear-gradient(45deg, #888 25%, transparent 25%), linear-gradient(-45deg, #888 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #888 75%), linear-gradient(-45deg, transparent 75%, #888 75%)", backgroundSize: "6px 6px", backgroundPosition: "0 0, 0 3px, 3px -3px, -3px 0" } },
              { value: "black" as PreviewBg, title: "Black", style: { backgroundColor: "#000" } },
              { value: "gray" as PreviewBg, title: "Gray", style: { backgroundColor: "#555" } },
              { value: "white" as PreviewBg, title: "White", style: { backgroundColor: "#fff" } },
            ]).map((opt) => (
              <button
                key={opt.value}
                className={`w-5 h-5 rounded border transition-colors ${previewBg === opt.value ? "border-[var(--accent)] ring-1 ring-[var(--accent)]" : "border-[var(--border)] hover:border-[var(--border-hover)]"}`}
                style={opt.style}
                onClick={() => onSetPreviewBg(opt.value)}
                title={opt.title}
              />
            ))}
          </div>
        )}
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) =>
          e.target.files && handleAddImages(e.target.files)
        }
      />

      {/* Toast notification */}
      {toast && (
        <div className="absolute left-1/2 -translate-x-1/2 bottom-0 translate-y-[calc(100%+8px)] z-50 px-4 py-2 rounded-lg bg-[var(--bg-elevated)] border border-[var(--border)] shadow-lg text-[12px] text-[var(--text-primary)] animate-[fadeInUp_0.2s_ease-out]">
          {toast}
        </div>
      )}
    </div>
  );
}
