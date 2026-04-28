# Research Lab — Deploy

Self-hosted stack: web UI + REST API + pipeline runner on a single host. The web container spawns pipeline containers on the same compose network via docker-out-of-docker, so topics kicked off from the UI run server-side.

## What's included

- `apps/web/Dockerfile` — standalone Next.js build with chromium for PDF export.
- `deploy/docker-compose.yml` — `web` + `searxng` services, bind-mounts for persistent state and the docker socket.
- `.env.example` — every configuration variable with comments.

## Server prerequisites

- Docker 24+ with the Compose plugin.
- ~2 GB free RAM (Next.js + chromium + SearXNG; pipeline containers transient, ~200 MB each).
- Outbound HTTPS to your LLM endpoint.
- Reverse proxy for TLS (Caddy / nginx / traefik).

## First deploy

1. On the server, clone the repo (or rsync the tree):

   ```
   git clone <url> /opt/research-lab
   cd /opt/research-lab
   ```

2. Create `deploy/.env`:

   ```
   cp deploy/.env.example deploy/.env
   # REQUIRED:
   #   SESSION_SECRET=$(openssl rand -hex 32)
   #   GEMMA_BASE_URL=<your LLM endpoint>
   # OPTIONAL:
   #   ADMIN_EMAIL / ADMIN_PASSWORD to seed the bootstrap admin via env;
   #   or BOOTSTRAP_TOKEN to allow exactly the intended first admin signup.
   #   In production, first signup is rejected unless one of these bootstrap
   #   controls is configured.
   ```

3. Check the docker socket GID on the host — the web container's `app`
   user needs it as a supplementary group to spawn pipeline containers:

   ```
   stat -c %g /var/run/docker.sock
   # set DOCKER_GID=<value> in deploy/.env (988 on Debian/Ubuntu, varies).
   ```

4. Build and start:

   ```
   cd deploy
   docker compose up -d --build
   ```

5. Point your reverse proxy at `127.0.0.1:3000`. Caddyfile:

   ```
   research.example.com {
     reverse_proxy 127.0.0.1:3000
   }
   ```

6. Open the domain. If `ADMIN_EMAIL/PASSWORD` was set, sign in with those.
   If using `BOOTSTRAP_TOKEN`, pass it during the first controlled signup
   flow or create the admin through the file store before opening public
   traffic. Do not leave first-admin signup publicly unprotected.

## Running research

- **From the UI**: dashboard has a "Start new research" form. Server spawns
  a transient pipeline container (image `oven/bun:1`) that mounts the repo
  and runs `src/run.ts <topic>`. Logs stream back to the UI via SSE.
- **From the API**: `POST /api/runs/start` with `{topic, constraints?}` and
  an API key or session cookie (see `/api/openapi.json`).
- **From the CLI on the server**: `docker exec -it research-lab-web bun
  run src/run.ts "<topic>"` — runs in the web container itself, writes to
  `/app/projects/<slug>/`.

Artifacts land in `../projects/<slug>/` on the host (bind-mounted into the
web container at `/app/projects`). The Next.js app reads fresh content on
every request — no restart needed after a pipeline run finishes.

## Managing users and keys

- **Users**: `/settings` → Users section (admin only). Invite by email +
  temp password; they change it at `/settings` → Change password after
  first login. Delete cleans up cleanly; the store prevents deleting your
  own account while signed in and the last admin.
- **API keys**: `/settings` → API keys. Raw key shown ONCE on creation.
  Keys hashed SHA-256 on disk. Revoke from the same page.

Programmatic consumers authenticate with:

```
X-API-Key: <key>
# or
Authorization: Bearer <key>
```

## Updating

```
# sync code + restart:
rsync -az --exclude /projects --exclude /data <source>:/opt/research-lab/
cd /opt/research-lab/deploy
docker compose up -d --build web
```

Persistent state in `../data/` (users, keys) and `../projects/` (research
artifacts) is kept across rebuilds.

## Troubleshooting

- `401` on browser page — session cookie invalid or expired; visit `/login`.
- `403` on `/api/admin/*` — your account isn't admin; session cookies for
  non-admin users get 403, not 401.
- `500` on pipeline spawn — check `stat -c %g /var/run/docker.sock` matches
  `DOCKER_GID`, and confirm `PIPELINE_NETWORK` equals the compose network
  name (usually `<deploy-dir>_default`).
- PDF export blank — `docker exec research-lab-web chromium-browser --version`
  should print a version; otherwise the image didn't bundle chromium.
- Healthcheck failing — `curl http://127.0.0.1:3000/api/health` should
  return `200 {"status":"ok"}` regardless of auth state.

## Security notes

- Session cookies require `SESSION_SECRET` to be set. If unset, middleware
  falls back to Basic Auth — fine for dev, not for prod.
- Production first-admin creation requires either `ADMIN_EMAIL` /
  `ADMIN_PASSWORD` or `BOOTSTRAP_TOKEN`. This prevents the first random
  visitor from claiming the admin role.
- Passwords are scrypt-hashed (N=16384) in `../data/users.json`. API keys
  are SHA-256 hashed in `../data/api_keys.json`. Neither store is
  encrypted at rest — put the volume on an encrypted filesystem if that
  matters for your threat model.
- Rotate `SESSION_SECRET` only when you intend to invalidate every
  outstanding session cookie. Rolling it requires every user to re-login.
- The web container runs as non-root `app` with the docker GID. It can
  spawn other containers via the socket but cannot escalate to the host.
- Always deploy behind TLS — all credentials flow over the same connection.
