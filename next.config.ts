import type { NextConfig } from "next";
import { PHASE_DEVELOPMENT_SERVER } from "next/constants";
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";

export default function nextConfig(phase: string): NextConfig {
  // Keep live development chunks separate from production builds.
  return { distDir: phase === PHASE_DEVELOPMENT_SERVER ? ".next-dev" : ".next" };
}

// Makes Cloudflare bindings reachable from next dev.
initOpenNextCloudflareForDev();
