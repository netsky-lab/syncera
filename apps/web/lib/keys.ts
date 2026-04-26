// File-backed API key store with create / list / revoke.
// Keys are hashed on disk (SHA-256); the raw secret is returned to the
// caller ONCE at creation time and never persisted in plaintext.
//
// Data file lives at $KEY_STORE_PATH (default: /app/data/api_keys.json)
// so it survives container rebuilds when the directory is volume-mounted.
//
// Env API_KEYS still honored as a seed set of "bootstrap" keys — useful
// for the very first admin login before any UI-generated keys exist.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { createHash, randomBytes } from "crypto";

export interface ApiKey {
  id: string;
  name: string;
  prefix: string; // first 8 chars of the raw key, for display
  hash: string; // sha256 of the raw key
  created_at: number;
  last_used_at: number | null;
  revoked_at: number | null;
  // Which user minted this key. Requests auth'd via this key inherit the
  // owner's visibility — they can read all of the owner's projects, not
  // just showcase. Env-seed keys (legacy) have `owner_uid: null`.
  owner_uid?: string | null;
}

// Resolve per-call so tests (and any env changes) take effect without a
// module reload.
function storePath(): string {
  return (
    process.env.KEY_STORE_PATH ??
    join(process.cwd(), "data", "api_keys.json")
  );
}

function ensureDir() {
  const dir = dirname(storePath());
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
}

function readAll(): ApiKey[] {
  const p = storePath();
  if (!existsSync(p)) return [];
  try {
    return JSON.parse(readFileSync(p, "utf-8"));
  } catch {
    return [];
  }
}

function writeAll(keys: ApiKey[]) {
  ensureDir();
  // mode 0o600 — stores SHA-256 hashes of raw keys; world-readable would
  // let anyone with a read bit correlate prefix → hash for offline guesses.
  writeFileSync(storePath(), JSON.stringify(keys, null, 2), { mode: 0o600 });
}

function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

export function listKeys(): Omit<ApiKey, "hash">[] {
  return readAll().map(({ hash, ...rest }) => rest);
}

// Create a new key. Returns { id, raw } where `raw` is shown to the user
// exactly once — never persisted. Pass `ownerUid` to scope the key to a
// user's projects; omit for bootstrap/admin keys (rarely what you want).
export function createKey(
  name: string,
  ownerUid: string | null = null
): { id: string; raw: string; prefix: string } {
  const all = readAll();
  const rawBytes = randomBytes(24);
  const raw = "rl_" + rawBytes.toString("hex");
  const id = "k_" + randomBytes(6).toString("hex");
  const prefix = raw.slice(0, 8);
  const entry: ApiKey = {
    id,
    name: name.trim() || "unnamed",
    prefix,
    hash: sha256(raw),
    created_at: Date.now(),
    last_used_at: null,
    revoked_at: null,
    owner_uid: ownerUid,
  };
  all.push(entry);
  writeAll(all);
  return { id, raw, prefix };
}

export function revokeKey(id: string): boolean {
  const all = readAll();
  const idx = all.findIndex((k) => k.id === id);
  if (idx === -1) return false;
  if (all[idx]!.revoked_at) return true;
  all[idx]!.revoked_at = Date.now();
  writeAll(all);
  return true;
}

// Verify a presented raw key. Returns the matching key record (minus hash)
// on success, or null. Updates last_used_at asynchronously.
export function verifyKey(raw: string): Omit<ApiKey, "hash"> | null {
  // Bootstrap keys from env — legacy path.
  const seedKeys = (process.env.API_KEYS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (seedKeys.includes(raw)) {
    return {
      id: "seed",
      name: "env (API_KEYS)",
      prefix: raw.slice(0, 8),
      created_at: 0,
      last_used_at: Date.now(),
      revoked_at: null,
    };
  }

  const all = readAll();
  const hash = sha256(raw);
  const match = all.find((k) => k.hash === hash && !k.revoked_at);
  if (!match) return null;

  // Best-effort update of last_used_at — don't fail the verify on write error.
  try {
    match.last_used_at = Date.now();
    writeAll(all);
  } catch {}

  const { hash: _, ...rest } = match;
  return rest;
}
