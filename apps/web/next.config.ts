import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Produce a self-contained .next/standalone build for minimal container images.
  output: "standalone",
  // The web app reads from ../../projects relative to cwd at runtime;
  // tell turbopack / next-file-tracing not to walk out of the monorepo root
  // when bundling.
  outputFileTracingRoot: process.cwd().replace(/\/apps\/web$/, ""),
  experimental: {
    // Cap request body at 1MB. Next 16 defaults to 10MB; our largest
    // legitimate POST (runs/start with topic + constraints) is a few
    // hundred chars, so 1MB is generous. Oversize bodies get truncated
    // to this limit before reaching proxy/handlers — cheap DoS guard.
    proxyClientMaxBodySize: "1mb",
  },
};

export default nextConfig;
