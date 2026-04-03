import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Document Auto-Crop",
  description:
    "AI-powered document boundary detection and perspective correction",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark h-full">
      <body className="h-dvh antialiased">{children}</body>
    </html>
  );
}
