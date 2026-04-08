import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  serverExternalPackages: ["@napi-rs/canvas", "pdf-to-png-converter"],
};

export default nextConfig;
