import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  basePath: "/rip",
  // Ensures assets are served from /rip/_next/...
  assetPrefix: "/rip",
};

export default nextConfig;
