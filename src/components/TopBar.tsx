"use client";

import { useRef, useCallback, useState } from "react";
import JSZip from "jszip";
import { useApp } from "../context/AppContext";
import { processImages } from "./imageProcessor";
import { rotateCanvas } from "../lib/crop";
import { exportPdf } from "../lib/pdfExport";

export default function TopBar() {
  const { state, dispatch } = useApp();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [exporting, setExporting] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);

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
    const sourceCanvas =
      filterType !== "none" && selectedImage.filteredCanvas
        ? selectedImage.filteredCanvas
        : selectedImage.cropCanvas;

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
        const sourceCanvas =
          filterType !== "none" && img.filteredCanvas
            ? img.filteredCanvas
            : img.cropCanvas;

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
      const pdfBlob = await exportPdf(state.images);
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
  }, [state.images]);

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
          {exporting ? "Exporting..." : `Download All as ZIP (${readyCount})`}
        </button>
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
