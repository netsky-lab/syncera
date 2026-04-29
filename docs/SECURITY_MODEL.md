# Syncera Security Model

Syncera is designed for self-hosted research workflows. It is not a multi-tenant SaaS control plane yet.

## Trust Boundaries

- Browser users authenticate through HMAC-signed session cookies.
- API consumers authenticate with hashed API keys.
- Research artifacts are file-backed under `projects/`.
- User/key/share state is file-backed under `data/`.
- Pipeline containers receive the LLM/search env needed for a run and write artifacts to the mounted repo.

## Current Controls

- Passwords are scrypt-hashed.
- API keys are SHA-256 hashed at rest and shown once.
- Production first-admin signup requires `ADMIN_EMAIL`/`ADMIN_PASSWORD` or `BOOTSTRAP_TOKEN`.
- CORS is fail-closed unless `API_CORS_ORIGINS` is configured.
- Browser sessions require `SESSION_SECRET`; Basic Auth fallback is for bootstrap/dev.
- Per-user project isolation is enforced in the web API.
- Webhook payloads are HMAC-signed with per-target secrets.

## Operational Requirements

- Serve only behind HTTPS.
- Keep `deploy/.env`, `data/`, and `projects/` out of git and public artifacts.
- Rotate `SESSION_SECRET` only when invalidating every session is acceptable.
- Treat Docker socket access as privileged. The web container can spawn sibling containers.
- Prefer SSH keys over password auth on production hosts.

## Known Gaps Before Hosted Multi-Tenant Use

- No organization/workspace-level RBAC beyond admin/user.
- No encrypted-at-rest artifact store.
- No per-key fine-grained scopes.
- No persistent database transaction layer.
- No sandbox for untrusted connectors beyond container isolation.

These gaps are acceptable for a self-hosted open-source product, but they should be closed before offering hosted enterprise tenancy.

