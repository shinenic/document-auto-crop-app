"use client";

import { useRef, useCallback, useState } from "react";
import JSZip from "jszip";
import { useApp } from "../context/AppContext";
import { processImages } from "./imageProcessor";
import { rotateCanvas } from "../lib/crop";
import { exportPdf } from "../lib/pdfExport";
import { applyEraseMask } from "../lib/eraser";
import { PDF_PAGE_SIZES, detectBestPageSize } from "../lib/types";
import type { PdfPageSize } from "../lib/types";

export default function TopBar({ onManageImages }: { onManageImages?: () => void }) {
  const { state, dispatch } = useApp();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [exporting, setExporting] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [pdfPageSize, setPdfPageSize] = useState<PdfPageSize>(PDF_PAGE_SIZES[0]); // Auto Detect
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

    // Apply erase mask if present
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
      // Resolve page size
      let pageSize: { widthMm: number; heightMm: number } | undefined;
      if (pdfPageSize.widthMm === 0) {
        // Auto Detect
        const readyImgs = state.images
          .filter((img) => img.status === "ready" && img.cropCanvas)
          .map((img) => ({ width: img.cropCanvas!.width, height: img.cropCanvas!.height }));
        const detected = detectBestPageSize(readyImgs);
        pageSize = { widthMm: detected.widthMm, heightMm: detected.heightMm };
      } else if (pdfPageSize.widthMm === -2) {
        // Custom
        pageSize = { widthMm: customW, heightMm: customH };
      } else if (pdfPageSize.widthMm > 0) {
        // Fixed preset
        pageSize = { widthMm: pdfPageSize.widthMm, heightMm: pdfPageSize.heightMm };
      }
      // widthMm === -1 → Fit to Image → pageSize stays undefined

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

  const readyCount = state.images.filter(
    (img) => img.status === "ready" && img.cropCanvas,
  ).length;

  return (
    <div className="h-12 flex items-center justify-between px-4 bg-[var(--bg-secondary)] border-b border-[var(--border)]">
      <div className="flex items-center gap-3">
        <span className="text-sm font-medium text-[var(--text-secondary)]">
          Document Auto-Crop
        </span>
        <span className="text-xs text-[var(--text-muted)]">
          {state.images.length} image
          {state.images.length !== 1 ? "s" : ""}
        </span>
      </div>

      <div className="flex items-center gap-2">
        <button
          className="px-3 py-1.5 text-xs font-medium rounded-lg bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)] transition-colors"
          onClick={() => fileInputRef.current?.click()}
        >
          + Add Images
        </button>
        {onManageImages && (
          <button
            className="px-3 py-1.5 text-xs font-medium rounded-lg bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)] transition-colors disabled:opacity-40"
            onClick={onManageImages}
            disabled={state.images.length === 0}
          >
            Manage Images
          </button>
        )}
        <button
          className="px-3 py-1.5 text-xs font-medium rounded-lg bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)] transition-colors disabled:opacity-40"
          onClick={handleExport}
          disabled={!state.selectedImageId}
        >
          Download JPEG
        </button>
        <button
          className="px-3 py-1.5 text-xs font-medium rounded-lg bg-[var(--accent)] text-[var(--bg-primary)] hover:bg-[var(--accent-hover)] transition-colors disabled:opacity-40 flex items-center gap-1.5"
          onClick={handleExportAll}
          disabled={readyCount === 0 || exporting}
        >
          {exporting && (
            <span className="inline-block w-3 h-3 border-2 border-[var(--bg-primary)] border-t-transparent rounded-full animate-spin" />
          )}
          {exporting ? "Exporting..." : `Download All Images as ZIP (${readyCount})`}
        </button>
        <select
          className="px-2 py-1.5 text-xs font-medium rounded-lg bg-[var(--bg-tertiary)] text-[var(--text-secondary)] border border-[var(--border)] cursor-pointer"
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
          <div className="flex items-center gap-1">
            <input
              type="number"
              className="w-14 px-1.5 py-1.5 text-xs rounded-lg bg-[var(--bg-tertiary)] text-[var(--text-secondary)] border border-[var(--border)] text-center"
              value={customW}
              min={50}
              max={1000}
              onChange={(e) => setCustomW(Number(e.target.value) || 210)}
            />
            <span className="text-[10px] text-[var(--text-muted)]">×</span>
            <input
              type="number"
              className="w-14 px-1.5 py-1.5 text-xs rounded-lg bg-[var(--bg-tertiary)] text-[var(--text-secondary)] border border-[var(--border)] text-center"
              value={customH}
              min={50}
              max={1000}
              onChange={(e) => setCustomH(Number(e.target.value) || 297)}
            />
            <span className="text-[10px] text-[var(--text-muted)]">mm</span>
          </div>
        )}
        <button
          className="px-3 py-1.5 text-xs font-medium rounded-lg bg-[var(--accent)] text-[var(--bg-primary)] hover:bg-[var(--accent-hover)] transition-colors disabled:opacity-40 flex items-center gap-1.5"
          onClick={handleExportPdf}
          disabled={readyCount === 0 || exportingPdf}
        >
          {exportingPdf && (
            <span className="inline-block w-3 h-3 border-2 border-[var(--bg-primary)] border-t-transparent rounded-full animate-spin" />
          )}
          {exportingPdf ? "Exporting..." : `Download PDF (${readyCount})`}
        </button>
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
