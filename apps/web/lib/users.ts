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
}

const STORE_PATH =
  process.env.USER_STORE_PATH ??
  join(process.cwd(), "data", "users.json");

function ensureDir() {
  const dir = dirname(STORE_PATH);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function readAll(): User[] {
  if (!existsSync(STORE_PATH)) return [];
  try {
    return JSON.parse(readFileSync(STORE_PATH, "utf-8"));
  } catch {
    return [];
  }
}

function writeAll(users: User[]) {
  ensureDir();
  writeFileSync(STORE_PATH, JSON.stringify(users, null, 2));
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
  };
  all.push(user);
  writeAll(all);
  const { password_hash, ...rest } = user;
  return { ok: true, user: rest };
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
