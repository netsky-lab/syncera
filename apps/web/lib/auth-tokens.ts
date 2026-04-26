// Signed one-shot tokens for email-verification and password-reset
// links. Stateless like session cookies but with a `kind` field so a
// verify-token can't be used as a password-reset-token. Uses the same
// SESSION_SECRET derivation as sessions.ts.

import { createHmac, timingSafeEqual } from "crypto";

function secret(): Buffer {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) {
    const fb =
      (process.env.BASIC_AUTH_PASS ?? "dev-insecure-fallback-change-me") +
      "::authtoken";
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

export type TokenKind = "verify_email" | "password_reset";

export interface TokenPayload {
  uid: string;
  kind: TokenKind;
  exp: number; // unix seconds
}

export function signToken(payload: Omit<TokenPayload, "exp">, ttlSeconds: number): string {
  const full: TokenPayload = {
    ...payload,
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
  };
  const encoded = b64url(JSON.stringify(full));
  const sig = b64url(createHmac("sha256", secret()).update(encoded).digest());
  return `${encoded}.${sig}`;
}

export function verifyToken(
  token: string | null | undefined,
  expectedKind: TokenKind
): TokenPayload | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [encoded, sig] = parts;
  try {
    const expected = createHmac("sha256", secret()).update(encoded!).digest();
    const presented = b64urlDecode(sig!);
    if (expected.length !== presented.length) return null;
    if (!timingSafeEqual(expected, presented)) return null;
    const payload = JSON.parse(
      b64urlDecode(encoded!).toString("utf-8")
    ) as TokenPayload;
    if (!payload.uid || !payload.kind || typeof payload.exp !== "number") return null;
    if (payload.kind !== expectedKind) return null;
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}
