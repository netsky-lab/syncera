# Research Lab — Deploy

Minimal self-hosted deployment of the read-only web UI. The research pipeline
(bun run src/run.ts ...) stays on your local machine; you rsync the generated
`projects/` directory to the server after each run.

## What's included

- `apps/web/Dockerfile` — standalone Next.js build with chromium for PDF
  export.
- `apps/web/middleware.ts` — HTTP Basic Auth gate, single shared password.
- `deploy/docker-compose.yml` — reference compose for a single-host server.

## Server prerequisites

- Docker 24+ with Compose plugin
- ~1 GB RAM minimum (Next.js + chromium)
- Outbound HTTPS to the machine running SearXNG / LLM endpoints (only if you
  also plan to run the pipeline on the server; default assumes you run the
  pipeline locally and only sync artifacts)
- Reverse proxy for TLS (Caddy / nginx / traefik recommended)

## First deploy

1. On the server, clone the repo (or rsync the whole tree):

   ```
   git clone <url> research-lab
   cd research-lab
   ```

2. Create `.env` inside `deploy/`:

   ```
   cp deploy/.env.example deploy/.env
   # edit and set BASIC_AUTH_PASS to a strong password
   ```

3. Sync your locally-generated projects:

   ```
   # from your local machine:
   rsync -avh --delete projects/ <server>:research-lab/projects/
   ```

4. Build and start:

   ```
   cd deploy
   docker compose up -d --build
   ```

5. Point your reverse proxy at `127.0.0.1:3000`. Example Caddyfile:

   ```
   research.example.com {
     reverse_proxy 127.0.0.1:3000
   }
   ```

6. Open the domain — browser prompts for username (`research` by default) and
   the password you set in `.env`.

## Updating after a new research run

Pipeline runs locally. To publish results:

```
# Locally:
bun run src/run.ts "<your topic>"
rsync -avh --delete projects/ <server>:research-lab/projects/
```

The container mounts `projects/` read-only; no restart needed to pick up new
artifacts — Next.js reads fresh content on every request.

## Rotating the password

Edit `deploy/.env`, then:

```
docker compose up -d  # picks up new env
```

## Troubleshooting

- `401 Authentication required` — you're hitting the auth gate. Username
  defaults to `research`, check `BASIC_AUTH_USER` in `.env`.
- `500` on a project page — either the project dir isn't mounted (check
  `docker compose logs web`) or the project was generated on a different
  schema version; both hypothesis-first (legacy) and question-first
  projects are supported.
- PDF export blank — chromium is bundled inside the image; check
  `docker exec research-lab-web chromium-browser --version`.
- Healthcheck fails — `curl http://127.0.0.1:3000/api/health` directly;
  this endpoint bypasses auth.

## Security notes

- Basic Auth over HTTP leaks the credential. Always deploy behind TLS.
- There's a single shared password — rotate it in `.env` whenever a
  collaborator leaves.
- `BASIC_AUTH_PASS` unset → auth disabled. Only unset in dev.
- The container runs as a non-root user `app` (uid 1001).
