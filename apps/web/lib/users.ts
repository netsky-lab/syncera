// File-backed user store. Passwords hashed with scrypt (Node built-in).
//
// Bootstrap: set ADMIN_EMAIL + ADMIN_PASSWORD env on first start. That
// account is seeded if missing. Subsequent logins go through the store.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { scryptSync, randomBytes, timingSafeEqual } from "crypto";

export type Role = "admin" | "user";

export interface User {
  id: string;
  email: string;
  password_hash: string; // "salt:hash" hex
  role: Role;
  created_at: number;
  last_login_at: number | null;
  // Per-user webhook: fires on run.completed / run.failed for runs owned
  // by this user. URL + secret stored plaintext (URL isn't sensitive;
  // secret has to be readable to sign outbound requests). Both null means
  // webhooks disabled for this user.
  webhook_url?: string | null;
  webhook_secret?: string | null;
  // Email verified via confirmation link. Historical users default to
  // true (back-compat: missing field treated as verified) so the check
  // only gates NEW signups post-2026-04-21.
  email_verified?: boolean;
  // Bumped whenever credentials change. Session cookies carry the value
  // they were issued with, so password changes can invalidate old cookies.
  session_version?: number;
}

// Resolve per-call so tests (and any env changes) take effect without
// needing a module reload.
function storePath(): string {
  return (
    process.env.USER_STORE_PATH ??
    join(process.cwd(), "data", "users.json")
  );
}

function ensureDir() {
  const dir = dirname(storePath());
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
}

function readAll(): User[] {
  const p = storePath();
  if (!existsSync(p)) return [];
  try {
    return JSON.parse(readFileSync(p, "utf-8"));
  } catch {
    return [];
  }
}

function writeAll(users: User[]) {
  ensureDir();
  // mode 0o600 — contains scrypt hashes; world-readable would still not
  // leak plaintext passwords but tightens the blast radius of any
  // accidental read permission on the volume.
  writeFileSync(storePath(), JSON.stringify(users, null, 2), { mode: 0o600 });
}

function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64, { N: 16384 });
  return `${salt.toString("hex")}:${hash.toString("hex")}`;
}

function verifyPassword(password: string, stored: string): boolean {
  try {
    const [saltHex, hashHex] = stored.split(":");
    if (!saltHex || !hashHex) return false;
    const salt = Buffer.from(saltHex, "hex");
    const expected = Buffer.from(hashHex, "hex");
    const actual = scryptSync(password, salt, 64, { N: 16384 });
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

export function findUserByEmail(email: string): User | null {
  const normalized = email.toLowerCase().trim();
  return readAll().find((u) => u.email.toLowerCase() === normalized) ?? null;
}

export function findUserById(id: string): User | null {
  return readAll().find((u) => u.id === id) ?? null;
}

export function listUsers(): Omit<User, "password_hash">[] {
  return readAll().map(({ password_hash, ...rest }) => rest);
}

export function createUser(params: {
  email: string;
  password: string;
  role?: Role;
  emailVerified?: boolean;
}): { ok: true; user: Omit<User, "password_hash"> } | { ok: false; error: string } {
  const email = params.email.toLowerCase().trim();
  if (!email || !/^[^@]+@[^@]+\.[^@]+$/.test(email)) {
    return { ok: false, error: "Invalid email" };
  }
  if (!params.password || params.password.length < 8) {
    return { ok: false, error: "Password must be at least 8 characters" };
  }
  const all = readAll();
  if (all.some((u) => u.email.toLowerCase() === email)) {
    return { ok: false, error: "Email already registered" };
  }
  const user: User = {
    id: "u_" + randomBytes(6).toString("hex"),
    email,
    password_hash: hashPassword(params.password),
    role: params.role ?? "user",
    created_at: Date.now(),
    last_login_at: null,
    email_verified: params.emailVerified ?? false,
    session_version: 0,
  };
  all.push(user);
  writeAll(all);
  const { password_hash, ...rest } = user;
  return { ok: true, user: rest };
}

export function markEmailVerified(userId: string): boolean {
  const all = readAll();
  const idx = all.findIndex((u) => u.id === userId);
  if (idx === -1) return false;
  all[idx]!.email_verified = true;
  writeAll(all);
  return true;
}

export function setPasswordByUid(userId: string, newPassword: string): { ok: true } | { ok: false; error: string } {
  if (!newPassword || newPassword.length < 8) {
    return { ok: false, error: "Password must be at least 8 characters" };
  }
  const all = readAll();
  const idx = all.findIndex((u) => u.id === userId);
  if (idx === -1) return { ok: false, error: "User not found" };
  all[idx]!.password_hash = hashPassword(newPassword);
  all[idx]!.session_version = (all[idx]!.session_version ?? 0) + 1;
  writeAll(all);
  return { ok: true };
}

export function authenticate(
  email: string,
  password: string
): { ok: true; user: Omit<User, "password_hash"> } | { ok: false } {
  const user = findUserByEmail(email);
  if (!user) return { ok: false };
  if (!verifyPassword(password, user.password_hash)) return { ok: false };
  // Update last_login_at best-effort
  try {
    const all = readAll();
    const idx = all.findIndex((u) => u.id === user.id);
    if (idx >= 0) {
      all[idx]!.last_login_at = Date.now();
      writeAll(all);
    }
  } catch {}
  const { password_hash, ...rest } = user;
  return { ok: true, user: rest };
}

export function updatePassword(
  userId: string,
  currentPassword: string,
  newPassword: string
): { ok: true } | { ok: false; error: string } {
  if (!newPassword || newPassword.length < 8) {
    return { ok: false, error: "New password must be at least 8 characters" };
  }
  const all = readAll();
  const idx = all.findIndex((u) => u.id === userId);
  if (idx === -1) return { ok: false, error: "User not found" };
  if (!verifyPassword(currentPassword, all[idx]!.password_hash)) {
    return { ok: false, error: "Current password is incorrect" };
  }
  all[idx]!.password_hash = hashPassword(newPassword);
  all[idx]!.session_version = (all[idx]!.session_version ?? 0) + 1;
  writeAll(all);
  return { ok: true };
}

export function setWebhook(
  userId: string,
  config: { url: string | null; secret: string | null }
): { ok: true } | { ok: false; error: string } {
  const all = readAll();
  const idx = all.findIndex((u) => u.id === userId);
  if (idx === -1) return { ok: false, error: "User not found" };
  if (config.url && !/^https?:\/\/.+/.test(config.url)) {
    return { ok: false, error: "Webhook URL must be http(s)://" };
  }
  all[idx]!.webhook_url = config.url;
  all[idx]!.webhook_secret = config.secret;
  writeAll(all);
  return { ok: true };
}

export function getWebhookTarget(
  userId: string
): { url: string; secret: string } | null {
  const u = findUserById(userId);
  if (!u?.webhook_url) return null;
  return { url: u.webhook_url, secret: u.webhook_secret ?? "" };
}

export function deleteUser(id: string): boolean {
  const all = readAll();
  const next = all.filter((u) => u.id !== id);
  if (next.length === all.length) return false;
  writeAll(next);
  return true;
}

// Seed admin from env on first use if store is empty.
export function ensureAdminSeed(): void {
  const all = readAll();
  if (all.length > 0) return;
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !password) return;
  const result = createUser({ email, password, role: "admin" });
  if (result.ok) {
    console.log(`[auth] seeded admin user ${email}`);
  }
}
