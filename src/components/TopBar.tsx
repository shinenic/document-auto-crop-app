"use client";

import { useRef, useCallback, useState, useEffect } from "react";
import JSZip from "jszip";
import { useApp } from "../context/AppContext";
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
}: {
  label: string;
  children: React.ReactNode;
  disabled?: boolean;
  accent?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

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

  const btnClass = accent
    ? "px-3 py-1.5 text-xs font-medium rounded-lg bg-[var(--accent)] text-[var(--bg-primary)] hover:bg-[var(--accent-hover)] transition-colors disabled:opacity-40 flex items-center gap-1"
    : "px-3 py-1.5 text-xs font-medium rounded-lg bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)] transition-colors disabled:opacity-40 flex items-center gap-1";

  return (
    <div ref={ref} className="relative">
      <button
        className={btnClass}
        onClick={() => setOpen((v) => !v)}
        disabled={disabled}
      >
        {label}
        <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor" className={`transition-transform ${open ? "rotate-180" : ""}`}>
          <path d="M2 3.5L5 6.5L8 3.5" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 min-w-[220px] bg-[var(--bg-elevated)] border border-[var(--border)] rounded-lg shadow-xl z-50 py-1 overflow-hidden">
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
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  shortcut?: string;
}) {
  return (
    <button
      className="w-full flex items-center justify-between px-3 py-2 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)] transition-colors disabled:opacity-30 disabled:pointer-events-none text-left"
      onClick={onClick}
      disabled={disabled}
    >
      <span>{label}</span>
      {shortcut && <span className="text-[10px] text-[var(--text-muted)] font-mono ml-3">{shortcut}</span>}
    </button>
  );
}

function MenuDivider() {
  return <div className="h-px bg-[var(--border)] my-1" />;
}

function MenuLabel({ children }: { children: React.ReactNode }) {
  return <div className="px-3 py-1 text-[9px] uppercase tracking-wider text-[var(--text-muted)] font-semibold">{children}</div>;
}

// --- Main Component ---

export default function TopBar({ onManageImages }: { onManageImages?: () => void }) {
  const { state, dispatch } = useApp();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [exporting, setExporting] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [pdfPageSize, setPdfPageSize] = useState<PdfPageSize>(PDF_PAGE_SIZES[0]);
  const [customW, setCustomW] = useState(210);
  const [customH, setCustomH] = useState(297);

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
    }, "image/jpeg", 0.92);
  }, [state.images, state.selectedImageId]);

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
    } finally {
      setExporting(false);
    }
  }, [state.images]);

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
    } catch (err) {
      console.error("PDF export failed:", err);
    } finally {
      setExportingPdf(false);
    }
  }, [state.images, pdfPageSize, customW, customH]);

  const multipleImages = state.images.filter((img) => img.editState != null).length > 1;

  const handleBatchRotateCW = useCallback(() => {
    dispatch({ type: "BATCH_ROTATE", rotation: 90 });
  }, [dispatch]);

  const handleBatchRotateCCW = useCallback(() => {
    dispatch({ type: "BATCH_ROTATE", rotation: 270 });
  }, [dispatch]);

  const [batchFilterType, setBatchFilterType] = useState<FilterConfig["type"]>("binarize");
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

  return (
    <div className="h-11 flex items-center justify-between px-3 bg-[var(--bg-secondary)] border-b border-[var(--border)]">
      <div className="flex items-center gap-3">
        <span className="text-sm font-semibold text-[var(--text-primary)]">
          Document Auto-Crop
        </span>
        <span className="text-xs text-[var(--text-muted)]">
          {state.images.length} image
          {state.images.length !== 1 ? "s" : ""}
        </span>
      </div>

      <div className="flex items-center gap-1.5">
        {/* Add Images */}
        <button
          className="px-3 py-1.5 text-xs font-medium rounded-lg bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)] transition-colors"
          onClick={() => fileInputRef.current?.click()}
        >
          + Add
        </button>

        {/* Manage Images */}
        {onManageImages && (
          <button
            className="px-3 py-1.5 text-xs font-medium rounded-lg bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)] transition-colors disabled:opacity-40"
            onClick={onManageImages}
            disabled={state.images.length === 0}
          >
            Manage
          </button>
        )}

        {/* Batch Operations Menu */}
        {multipleImages && (
          <DropdownMenu label="Batch">
            <MenuLabel>Rotate All</MenuLabel>
            <MenuItem label="Rotate All 90° CW" onClick={handleBatchRotateCW} />
            <MenuItem label="Rotate All 90° CCW" onClick={handleBatchRotateCCW} />
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
                    <div className="flex justify-between text-[10px]">
                      <span className="text-[var(--text-muted)]">Block Radius</span>
                      <span className="font-mono text-[var(--text-secondary)]">{batchBinarize.blockRadiusBps}</span>
                    </div>
                    <input type="range" min={20} max={1000} step={10} value={batchBinarize.blockRadiusBps}
                      className="w-full h-3"
                      onChange={(e) => setBatchBinarize((prev) => ({ ...prev, blockRadiusBps: Number(e.target.value) }))}
                    />
                  </label>
                  <label className="flex flex-col gap-0.5">
                    <div className="flex justify-between text-[10px]">
                      <span className="text-[var(--text-muted)]">Contrast</span>
                      <span className="font-mono text-[var(--text-secondary)]">{batchBinarize.contrastOffset}</span>
                    </div>
                    <input type="range" min={-50} max={10} step={1} value={batchBinarize.contrastOffset}
                      className="w-full h-3"
                      onChange={(e) => setBatchBinarize((prev) => ({ ...prev, contrastOffset: Number(e.target.value) }))}
                    />
                  </label>
                  <label className="flex flex-col gap-0.5">
                    <div className="flex justify-between text-[10px]">
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
          </DropdownMenu>
        )}

        <div className="w-px h-5 bg-[var(--border)]" />

        {/* Export Menu */}
        <DropdownMenu label="Export" accent>
          <MenuItem
            label="Download Current as JPEG"
            onClick={handleExport}
            disabled={!state.selectedImageId}
            shortcut="^S"
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
                  {s.label}{s.widthMm > 0 ? ` (${s.widthMm}×${s.heightMm})` : ""}
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
                <span className="text-[10px] text-[var(--text-muted)]">×</span>
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
      </div>
    </div>
  );
}
