// File-backed share-token store. A share token grants read-only access
// to one project without a session cookie — used to hand a link to a
// colleague who doesn't (or shouldn't) have an account.
//
// Storage: data/share_tokens.json — array of { token, slug, created_by, created_at, revoked_at }

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { randomBytes } from "crypto";

interface ShareToken {
  token: string;
  slug: string;
  created_by: string;
  created_at: number;
  revoked_at: number | null;
}

function storePath(): string {
  return (
    process.env.SHARE_TOKEN_STORE_PATH ??
    join(process.cwd(), "data", "share_tokens.json")
  );
}

function ensureDir() {
  const dir = dirname(storePath());
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
}

function readAll(): ShareToken[] {
  const p = storePath();
  if (!existsSync(p)) return [];
  try {
    return JSON.parse(readFileSync(p, "utf-8"));
  } catch {
    return [];
  }
}

function writeAll(tokens: ShareToken[]) {
  ensureDir();
  writeFileSync(storePath(), JSON.stringify(tokens, null, 2), { mode: 0o600 });
}

export function createShareToken(slug: string, createdBy: string): ShareToken {
  const all = readAll();
  // Reuse an existing active token for this (slug, creator) if one
  // exists — otherwise we'd produce a fresh link every click.
  const existing = all.find(
    (t) =>
      t.slug === slug && t.created_by === createdBy && t.revoked_at == null
  );
  if (existing) return existing;
  const token = randomBytes(18).toString("base64url");
  const entry: ShareToken = {
    token,
    slug,
    created_by: createdBy,
    created_at: Date.now(),
    revoked_at: null,
  };
  all.push(entry);
  writeAll(all);
  return entry;
}

export function resolveShareToken(token: string): ShareToken | null {
  const entry = readAll().find((t) => t.token === token);
  if (!entry) return null;
  if (entry.revoked_at != null) return null;
  return entry;
}

export function listShareTokens(slug: string): ShareToken[] {
  return readAll().filter((t) => t.slug === slug && t.revoked_at == null);
}

export function revokeShareToken(token: string): boolean {
  const all = readAll();
  const idx = all.findIndex((t) => t.token === token);
  if (idx === -1) return false;
  if (all[idx]!.revoked_at != null) return true;
  all[idx]!.revoked_at = Date.now();
  writeAll(all);
  return true;
}
