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
    <div className="h-dvh flex flex-col items-center justify-center p-8">
      <div className="text-center mb-8">
        <h1 className="text-3xl font-semibold tracking-tight mb-2">
          Document Auto-Crop
        </h1>
        <p className="text-[var(--text-secondary)]">
          Upload document photos for automatic boundary detection and
          perspective correction
        </p>
      </div>

      <div
        className={`
          w-full max-w-xl aspect-[4/3] rounded-2xl border-2 border-dashed
          flex flex-col items-center justify-center gap-4 cursor-pointer
          transition-all duration-200
          ${
            dragOver
              ? "border-[var(--accent)] bg-[var(--accent-muted)] scale-[1.02]"
              : "border-[var(--border)] hover:border-[var(--border-hover)] bg-[var(--bg-secondary)]"
          }
        `}
        onDrop={handleDrop}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onClick={() => fileInputRef.current?.click()}
      >
        <div className="w-16 h-16 rounded-full bg-[var(--bg-tertiary)] flex items-center justify-center">
          <svg
            className="w-8 h-8 text-[var(--text-secondary)]"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={1.5}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5"
            />
          </svg>
        </div>
        <div className="text-center">
          <p className="text-[var(--text-primary)] font-medium">
            Drop images here
          </p>
          <p className="text-sm text-[var(--text-muted)] mt-1">
            or click to browse files
          </p>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) =>
            e.target.files && handleFiles(e.target.files)
          }
        />
      </div>

      <p className="text-xs text-[var(--text-muted)] mt-4">
        Supports JPEG, PNG, WebP
      </p>
    </div>
  );
}
