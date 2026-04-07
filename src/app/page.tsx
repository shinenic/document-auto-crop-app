"use client";

import { AppProvider, useApp } from "../context/AppContext";
import { DraftProvider } from "../context/DraftContext";
import UploadScreen from "../components/UploadScreen";
import EditorScreen from "../components/EditorScreen";

function AppContent() {
  const { state } = useApp();

  if (state.screen === "upload") {
    return <UploadScreen />;
  }

  return <EditorScreen />;
}

export default function Home() {
  return (
    <AppProvider>
      <DraftProvider>
        <AppContent />
      </DraftProvider>
    </AppProvider>
  );
}
