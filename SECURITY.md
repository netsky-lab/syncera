# Security Policy

## Supported Scope

Security issues should be reported for the current `main` branch and the deployed Docker stack described in `deploy/`.

## Reporting

Do not open a public issue for a vulnerability. Email the maintainer or send a private disclosure with:

- affected route, CLI phase, or artifact;
- reproduction steps;
- expected vs actual access boundary;
- whether secrets, user projects, API keys, or LLM spend are exposed.

## Threat Model

Syncera is a self-hosted research system. The main assets are:

- `data/users.json` and `data/api_keys.json`;
- `projects/<slug>/` research artifacts;
- LLM endpoint credentials in `deploy/.env`;
- Docker socket access used by the web container to spawn pipeline runs.

Expected production baseline:

- `SESSION_SECRET` set to a random 32+ byte value;
- TLS in front of the web container;
- first admin created through `ADMIN_EMAIL` / `ADMIN_PASSWORD` or protected with `BOOTSTRAP_TOKEN`;
- `API_CORS_ORIGINS` pinned to trusted origins or left empty;
- `data/`, `projects/`, `.env`, and `.private/` excluded from git and backups handled as sensitive data.

## Known Operational Risks

- Mounting `/var/run/docker.sock` gives the web container power to create sibling containers. Run this only on a host dedicated to Syncera or behind a hard access boundary.
- Research artifacts may contain user-supplied prompts and scraped source content. Treat `projects/` as confidential unless you intentionally publish a project.
- API keys are hashed at rest, but users and webhook secrets live in the file store. Use disk encryption when the host is shared.

