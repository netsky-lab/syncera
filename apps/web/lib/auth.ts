// Final auth check for route handlers (Node runtime). Middleware is Edge
// and can't read our file-backed key store, so it lets through anything
// with the shape of credentials; this helper validates them for real.

import { verifyKey } from "@/lib/keys";

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
      { error: "Unauthorized — provide a valid API key or Basic auth" },
      { status: 401 }
    ),
  };
}

// Admin endpoints want Basic Auth only. API key cannot mint more keys.
export function requireBasicAuth(request: Request): { ok: true } | { ok: false; response: Response } {
  const basicPass = process.env.BASIC_AUTH_PASS;
  if (!basicPass) return { ok: true }; // auth disabled in dev
  const authHeader = request.headers.get("authorization");
  if (authHeader?.startsWith("Basic ")) {
    const user = process.env.BASIC_AUTH_USER ?? "research";
    const expected = "Basic " + Buffer.from(`${user}:${basicPass}`).toString("base64");
    if (authHeader === expected) return { ok: true };
  }
  return {
    ok: false,
    response: Response.json(
      { error: "Admin endpoints require Basic Auth (not API key)" },
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
