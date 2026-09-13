import type { NextConfig } from "next";

// PitchTerminal V2 frontend — deployment config.
//
// FINAL INTENT: this application owns the root domain (https://www.pitchterminal.com/).
// It therefore ships with NO basePath by default — routes serve from the root.
//
// `/v2` and `/pitch` are NOT permanent namespaces. A temporary deployment slot
// (for migration/testing coexistence with the legacy frontend) may be set with
// NEXT_PUBLIC_BASE_PATH, e.g. NEXT_PUBLIC_BASE_PATH=/pitchv2 for a staging mount.
// That env is migration infrastructure only; production leaves it unset (root).
const basePath = process.env.NEXT_PUBLIC_BASE_PATH?.trim() || undefined;

const nextConfig: NextConfig = {
  output: "standalone",
  ...(basePath ? { basePath, assetPrefix: basePath } : {}),
};

export default nextConfig;
