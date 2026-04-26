// Final auth check for route handlers (Node runtime). Middleware is Edge
// and can't read our file-backed key store, so it lets through anything
// with the shape of credentials; this helper validates them for real.

import { verifyKey } from "@/lib/keys";
import { verifySession, COOKIE_NAME } from "@/lib/sessions";

/** Extract the viewer's uid for the purpose of project-visibility filtering.
 *  Priority: session cookie (uid from signed payload) → API key (uid of
 *  the user who minted the key). Returns null if neither is present or
 *  both are anonymous (e.g. env-seed API_KEYS which have no owner). */
export function viewerUidFromRequest(request: Request): string | null {
  const cookie = request.headers.get("cookie") ?? "";
  const m = cookie.match(new RegExp(`(?:^|;\\s*)${COOKIE_NAME}=([^;]+)`));
  const sessionUid = verifySession(m?.[1])?.uid;
  if (sessionUid) return sessionUid;

  const rawKey = apiKeyFromHeaders(request.headers);
  if (rawKey) {
    const record = verifyKey(rawKey);
    if (record?.owner_uid) return record.owner_uid;
  }
  return null;
}

function apiKeyFromHeaders(headers: Headers): string | null {
  const h = headers.get("x-api-key");
  if (h) return h;
  const a = headers.get("authorization");
  if (a?.startsWith("Bearer ")) return a.slice(7);
  return null;
}

export function requireAuth(request: Request): { ok: true } | { ok: false; response: Response } {
  const basicPass = process.env.BASIC_AUTH_PASS;
  if (!basicPass && !process.env.API_KEYS && !hasStoredKeys()) {
    // Auth fully disabled (dev mode)
    return { ok: true };
  }

  // Session cookie — browser UI issued via /api/auth/login.
  const cookie = request.headers.get("cookie") ?? "";
  if (cookie.includes("rl_session=")) {
    const { COOKIE_NAME, verifySession } = require("@/lib/sessions");
    const match = cookie.match(new RegExp(`(?:^|;\\s*)${COOKIE_NAME}=([^;]+)`));
    if (verifySession(match?.[1])) return { ok: true };
  }

  // API key — env seed or file-backed
  const rawKey = apiKeyFromHeaders(request.headers);
  if (rawKey) {
    const seedKeys = (process.env.API_KEYS ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (seedKeys.includes(rawKey)) return { ok: true };
    if (verifyKey(rawKey)) return { ok: true };
  }

  // Basic Auth fallback
  const authHeader = request.headers.get("authorization");
  if (basicPass && authHeader?.startsWith("Basic ")) {
    const user = process.env.BASIC_AUTH_USER ?? "research";
    const expected = "Basic " + Buffer.from(`${user}:${basicPass}`).toString("base64");
    if (authHeader === expected) return { ok: true };
  }

  return {
    ok: false,
    response: Response.json(
      { error: "Unauthorized — provide a valid API key, Bearer token, Basic auth, or session cookie" },
      { status: 401 }
    ),
  };
}

// Admin endpoints require an admin-role session cookie (or Basic Auth as
// pre-migration fallback). API keys cannot mint more keys.
export function requireBasicAuth(request: Request): { ok: true } | { ok: false; response: Response } {
  // Session cookie with admin role
  const cookie = request.headers.get("cookie") ?? "";
  const { COOKIE_NAME, verifySession } = require("@/lib/sessions");
  const { findUserById } = require("@/lib/users");
  const match = cookie.match(new RegExp(`(?:^|;\\s*)${COOKIE_NAME}=([^;]+)`));
  const session = verifySession(match?.[1]);
  if (session) {
    const user = findUserById(session.uid);
    if (user?.role === "admin") return { ok: true };
    if (user) {
      return {
        ok: false,
        response: Response.json(
          { error: "Admin role required" },
          { status: 403 }
        ),
      };
    }
  }

  // Legacy basic auth — still accepted so env-admin can work before any
  // user accounts exist.
  const basicPass = process.env.BASIC_AUTH_PASS;
  if (!basicPass && !process.env.SESSION_SECRET) return { ok: true };
  if (basicPass) {
    const authHeader = request.headers.get("authorization");
    if (authHeader?.startsWith("Basic ")) {
      const user = process.env.BASIC_AUTH_USER ?? "research";
      const expected = "Basic " + Buffer.from(`${user}:${basicPass}`).toString("base64");
      if (authHeader === expected) return { ok: true };
    }
  }
  return {
    ok: false,
    response: Response.json(
      { error: "Admin authentication required — sign in with an admin account" },
      { status: 401 }
    ),
  };
}

function hasStoredKeys(): boolean {
  // Lightweight probe — listKeys reads the file anyway.
  try {
    const { listKeys } = require("@/lib/keys");
    return listKeys().length > 0;
  } catch {
    return false;
  }
}
