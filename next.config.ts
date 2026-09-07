import type { NextConfig } from "next";
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";

const nextConfig: NextConfig = {};

export default nextConfig;

// Makes Cloudflare bindings (R2, IMAGES, ...) reachable from `next dev`.
initOpenNextCloudflareForDev();
