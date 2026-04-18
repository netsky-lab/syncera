import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Produce a self-contained .next/standalone build for minimal container images.
  output: "standalone",
  // The web app reads from ../../projects relative to cwd at runtime;
  // tell turbopack / next-file-tracing not to walk out of the monorepo root
  // when bundling.
  outputFileTracingRoot: process.cwd().replace(/\/apps\/web$/, ""),
};

export default nextConfig;
