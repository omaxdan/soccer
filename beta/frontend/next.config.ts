import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // BETA: served at /beta (pitchterminal white-label track).
  // The old frontend keeps /rip untouched until cutover.
  basePath: "/beta",
  assetPrefix: "/beta",
};

export default nextConfig;
