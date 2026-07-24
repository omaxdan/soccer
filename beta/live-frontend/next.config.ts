import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  basePath: "/pitch",
  // Ensures assets are served from /pitch/_next/...
  assetPrefix: "/pitch",
};

export default nextConfig;
