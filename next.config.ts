import type { NextConfig } from "next";
import path from "node:path";

const isProd = process.env.NODE_ENV === "production";

const nextConfig: NextConfig = {
  output: "export",
  basePath: isProd ? "/document-auto-crop-app" : "",
  turbopack: {
    root: path.resolve(__dirname),
  },
};

export default nextConfig;
