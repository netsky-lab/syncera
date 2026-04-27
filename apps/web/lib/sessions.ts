// HMAC-signed session cookie. No server-side session store — stateless.
//
// Cookie value: base64url(JSON({ uid, exp })) + "." + base64url(HMAC-SHA256)
// Verified and decoded in one step. 30-day expiry by default.

import { createHmac, timingSafeEqual } from "crypto";

const COOKIE_NAME = "rl_session";
const MAX_AGE_S = 60 * 60 * 24 * 30; // 30 days

function secret(): Buffer {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) {
    // Deterministic fallback derived from BASIC_AUTH_PASS so sessions don't
    // silently invalidate on restart in dev, but in prod ALWAYS set
    // SESSION_SECRET to a random 32+ char string.
    const fb = (process.env.BASIC_AUTH_PASS ?? "dev-insecure-fallback-change-me") + "::session";
    return Buffer.from(fb.padEnd(32, "x"));
  }
  return Buffer.from(s);
}

function b64url(buf: Buffer | string): string {
  const b = typeof buf === "string" ? Buffer.from(buf) : buf;
  return b
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function b64urlDecode(s: string): Buffer {
  const b = s.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(b + "===".slice((b.length + 3) % 4), "base64");
}

export interface SessionPayload {
  uid: string;
  exp: number; // unix seconds
  sv?: number; // user.session_version when issued
}

export function signSession(uid: string, sessionVersion?: number): string {
  const payload: SessionPayload = {
    uid,
    exp: Math.floor(Date.now() / 1000) + MAX_AGE_S,
  };
  if (sessionVersion != null) payload.sv = sessionVersion;
  const encoded = b64url(JSON.stringify(payload));
  const sig = b64url(createHmac("sha256", secret()).update(encoded).digest());
  return `${encoded}.${sig}`;
}

export function verifySession(token: string | null | undefined): SessionPayload | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [encoded, sig] = parts;
  try {
    const expected = createHmac("sha256", secret()).update(encoded!).digest();
    const presented = b64urlDecode(sig!);
    if (expected.length !== presented.length) return null;
    if (!timingSafeEqual(expected, presented)) return null;
    const payload = JSON.parse(b64urlDecode(encoded!).toString("utf-8")) as SessionPayload;
    if (!payload.uid || typeof payload.exp !== "number") return null;
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

export function verifySessionUser(token: string | null | undefined): SessionPayload | null {
  const payload = verifySession(token);
  if (!payload) return null;
  // Internal short-lived session used by PDF rendering; not a real user.
  if (payload.uid.startsWith("_")) return payload;
  try {
    const { findUserById } = require("@/lib/users") as typeof import("./users");
    const user = findUserById(payload.uid);
    if (!user) return null;
    const currentVersion = user.session_version ?? 0;
    if (payload.sv != null && payload.sv !== currentVersion) return null;
    if (payload.sv == null && currentVersion > 0) return null;
    return payload;
  } catch {
    return payload;
  }
}

export function isSecureRequest(request: Request): boolean {
  const forwardedProto = request.headers.get("x-forwarded-proto");
  if (forwardedProto?.split(",")[0]?.trim() === "https") return true;
  if (request.url.startsWith("https://")) return true;
  const appBase = process.env.APP_BASE_URL ?? process.env.PUBLIC_URL ?? "";
  return appBase.startsWith("https://");
}

export function sessionCookieHeader(value: string, isSecure = true): string {
  const parts = [
    `${COOKIE_NAME}=${value}`,
    `Max-Age=${MAX_AGE_S}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
  ];
  if (isSecure) parts.push("Secure");
  return parts.join("; ");
}

export function clearCookieHeader(isSecure = true): string {
  const parts = [
    `${COOKIE_NAME}=`,
    `Max-Age=0`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
  ];
  if (isSecure) parts.push("Secure");
  return parts.join("; ");
}

export { COOKIE_NAME };
