# Syncera web UI — standalone Next.js build served by Node.
# Two-stage: build with Bun (fast install + compile), run with Node.
# The container is read-write: the web process mutates /app/projects
# when pipelines run (spawned via the mounted host docker socket),
# and /app/data for the users/keys store. Both should be bind-mounted
# from the host for persistence across rebuilds — see deploy/docker-compose.yml.

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

# Chromium for PDF export + docker CLI so the web container can spawn
# sibling pipeline containers via the host docker socket.
RUN apk add --no-cache \
      chromium nss freetype harfbuzz ca-certificates ttf-freefont \
      docker-cli rsync \
    && addgroup -g 1001 -S app && adduser -u 1001 -S app -G app \
    # Docker socket is typically owned by root:docker on the host with 660.
    # Add app to the docker group so it can invoke the daemon.
    && addgroup -S docker && adduser app docker \
    && chown -R app:app /app

ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
ENV PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium-browser
ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
# Runtime env lives in deploy/.env, not baked into the image. Required at
# runtime: SESSION_SECRET, GEMMA_BASE_URL. Optional: ADMIN_EMAIL/PASSWORD,
# ALLOW_SIGNUP, API_KEYS, API_CORS_ORIGINS. See deploy/.env.example.

USER app
EXPOSE 3000

# The standalone server.js is at apps/web/server.js
CMD ["node", "apps/web/server.js"]
