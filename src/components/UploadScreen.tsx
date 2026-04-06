"use client";

import { useCallback, useRef, useState } from "react";
import { useApp } from "../context/AppContext";
import { processImages } from "./imageProcessor";

export default function UploadScreen() {
  const { state, dispatch } = useApp();
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFiles = useCallback(
    (files: FileList | File[]) => {
      const imageFiles = Array.from(files).filter((f) =>
        f.type.startsWith("image/"),
      );
      if (imageFiles.length === 0) return;
      dispatch({ type: "SET_SCREEN", screen: "editor" });
      processImages(imageFiles, dispatch, state.selectedImageId);
    },
    [dispatch, state.selectedImageId],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      handleFiles(e.dataTransfer.files);
    },
    [handleFiles],
  );

  return (
    <div
      className={`h-dvh flex flex-col items-center justify-center p-8 relative overflow-hidden cursor-pointer transition-colors duration-200 ${
        dragOver ? "bg-[var(--accent-muted)]" : ""
      }`}
      onDrop={handleDrop}
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onClick={() => fileInputRef.current?.click()}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fileInputRef.current?.click(); } }}
      role="button"
      tabIndex={0}
    >
      {/* Subtle staff lines background */}
      <div className="absolute inset-0 pointer-events-none opacity-[0.03]" aria-hidden>
        <svg width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <pattern id="staff" x="0" y="0" width="100%" height="48" patternUnits="userSpaceOnUse">
              {[0, 10, 20, 30, 40].map((y) => (
                <line key={y} x1="0" y1={y} x2="100%" y2={y} stroke="currentColor" strokeWidth="1" />
              ))}
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#staff)" />
        </svg>
      </div>

      {/* Drag-over overlay — full-screen scrim + border + prominent label */}
      <div className={`absolute inset-0 pointer-events-none z-10 transition-opacity duration-150 ${dragOver ? "opacity-100" : "opacity-0"}`}>
        <div className="absolute inset-0 bg-[var(--accent)]/8" />
        <div className="absolute inset-4 rounded-xl border-2 border-dashed border-[var(--accent)]" />
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="flex flex-col items-center gap-3 px-8 py-6 rounded-2xl bg-[var(--bg-secondary)]/90 border border-[var(--accent)]/30 shadow-2xl backdrop-blur-sm">
            <svg className="w-10 h-10 text-[var(--accent)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
            </svg>
            <p className="text-[16px] font-semibold text-[var(--accent)]">Drop to upload</p>
          </div>
        </div>
      </div>

      <div className={`text-center mb-10 relative transition-opacity duration-150 ${dragOver ? "opacity-30" : ""}`}>
        <h1 className="text-3xl font-semibold tracking-tight mb-3 text-[var(--text-primary)]">
          Document Auto-Crop
        </h1>
        <p className="text-[var(--text-secondary)] text-[15px] leading-relaxed max-w-md mx-auto">
          Upload document photos for automatic boundary detection,
          perspective correction, and B&W processing
        </p>
      </div>

      <div className={`relative w-full max-w-lg aspect-[4/3] rounded-xl border-2 border-dashed
        flex flex-col items-center justify-center gap-5
        transition-all duration-150
        ${dragOver
          ? "opacity-30 border-transparent bg-transparent"
          : "border-[var(--border-hover)] hover:border-[var(--accent)]/40 bg-[var(--bg-secondary)]"
        }`}
      >
        <div className={`w-14 h-14 rounded-xl flex items-center justify-center transition-colors ${dragOver ? "bg-[var(--accent)]/15" : "bg-[var(--bg-tertiary)]"}`}>
          <svg className={`w-7 h-7 transition-colors ${dragOver ? "text-[var(--accent)]" : "text-[var(--text-muted)]"}`}
            fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round"
              d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
          </svg>
        </div>
        <div className="text-center">
          <p className="text-[var(--text-primary)] font-medium text-[14px]">
            Drop images here
          </p>
          <p className="text-[13px] text-[var(--text-muted)] mt-1">
            or click to browse
          </p>
        </div>

        <input ref={fileInputRef} type="file" accept="image/*" multiple className="hidden"
          onChange={(e) => e.target.files && handleFiles(e.target.files)} />
      </div>

      <div className="flex items-center gap-4 mt-5 text-[12px] text-[var(--text-muted)]">
        <span>JPEG</span>
        <span className="w-px h-3 bg-[var(--border)]" />
        <span>PNG</span>
        <span className="w-px h-3 bg-[var(--border)]" />
        <span>WebP</span>
      </div>

      {/* Workflow hint */}
      <div className="mt-8 flex items-center gap-6 text-[11px] text-[var(--text-muted)]">
        <span>Upload</span>
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true"><path d="M2 6h8M7 3l3 3-3 3" /></svg>
        <span>Auto-Crop</span>
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true"><path d="M2 6h8M7 3l3 3-3 3" /></svg>
        <span>Filter</span>
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true"><path d="M2 6h8M7 3l3 3-3 3" /></svg>
        <span>Export</span>
      </div>
    </div>
  );
}
