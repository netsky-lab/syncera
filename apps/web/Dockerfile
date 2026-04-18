# Research Lab web UI — standalone Next.js build served by Node.
# Two-stage: build with Bun (fast install + compile), run with Node.
# Image is a read-only viewer; it expects the host to mount the projects
# directory at /app/projects.

# ---- Stage 1: build ----
FROM oven/bun:1 AS builder

WORKDIR /app

# Copy monorepo workspace files first for layer caching
COPY package.json bun.lock tsconfig.json ./
COPY apps/web/package.json ./apps/web/
COPY apps/web/bun.lock* ./apps/web/

# Install deps inside apps/web specifically (it has its own lockfile)
WORKDIR /app/apps/web
RUN bun install --frozen-lockfile

# Copy the rest of the web app source
COPY apps/web ./

# Copy playwright.config.ts / tests only if needed — next build will skip them
# Build the standalone bundle
RUN bun run build

# ---- Stage 2: runtime ----
FROM node:22-alpine AS runner

WORKDIR /app

# Standalone output includes a trimmed node_modules and server.js
COPY --from=builder /app/apps/web/.next/standalone ./
COPY --from=builder /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder /app/apps/web/public ./apps/web/public

# Playwright needs chromium for PDF export. Install minimal chromium.
RUN apk add --no-cache chromium nss freetype harfbuzz ca-certificates ttf-freefont \
    && addgroup -g 1001 -S app && adduser -u 1001 -S app -G app \
    && chown -R app:app /app

ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
ENV PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium-browser
ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
# BASIC_AUTH_PASS must be set at runtime via docker-compose or -e flag
# ENV BASIC_AUTH_USER=research
# ENV BASIC_AUTH_PASS=...

USER app
EXPOSE 3000

# The standalone server.js is at apps/web/server.js
CMD ["node", "apps/web/server.js"]
