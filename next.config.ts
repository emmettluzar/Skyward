import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // MapLibre GL ships ESM and its own CSS; no transpilation needed.
  // Explicitly allow its CSS to be imported from node_modules.
  transpilePackages: ["maplibre-gl"],
};

export default nextConfig;