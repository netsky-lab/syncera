import type { NextConfig } from "next";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const appDir = dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  // Produce a self-contained .next/standalone build for minimal container images.
  output: "standalone",
  turbopack: {
    root: join(appDir, "../.."),
  },
  experimental: {
    // Cap request body at 1MB. Next 16 defaults to 10MB; our largest
    // legitimate POST (runs/start with topic + constraints) is a few
    // hundred chars, so 1MB is generous. Oversize bodies get truncated
    // to this limit before reaching proxy/handlers — cheap DoS guard.
    proxyClientMaxBodySize: "1mb",
  },
};

export default nextConfig;
