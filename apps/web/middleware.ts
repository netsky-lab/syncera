import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Middleware responsibilities (Edge runtime — no fs access):
//   - CORS preflight + response headers on /api/*
//   - Token-bucket rate limit per identity on /api/*
//   - Basic-Auth gate for HUMAN pages (/, /projects/..., /docs) when
//     BASIC_AUTH_PASS is set
//
// API auth (key validation) happens inside each route handler via
// lib/auth.ts#requireAuth(), because Edge middleware can't read our
// file-backed key store.

const EXCLUDED_PREFIXES = [
  "/_next/",
  "/favicon",
  "/api/health",
  "/api/auth/", // login/signup/me/logout — must be reachable pre-auth
  "/login",
  "/signup",
];

const SESSION_COOKIE = "rl_session";

async function verifySessionToken(token: string | null | undefined): Promise<boolean> {
  if (!token || !token.includes(".")) return false;
  const [encoded, sig] = token.split(".");
  if (!encoded || !sig) return false;
  try {
    const s = process.env.SESSION_SECRET ?? process.env.BASIC_AUTH_PASS ?? "dev-insecure-fallback-change-me";
    const keyMaterial = new TextEncoder().encode(s.padEnd(32, "x"));
    const key = await crypto.subtle.importKey(
      "raw",
      keyMaterial,
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );
    const expected = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(encoded));
    const expectedB64 = Buffer.from(expected).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    if (expectedB64 !== sig) return false;
    // Decode payload to check expiry
    const pad = "===".slice((encoded.length + 3) % 4);
    const json = atob(encoded.replace(/-/g, "+").replace(/_/g, "/") + pad);
    const payload = JSON.parse(json);
    if (!payload?.exp || payload.exp < Math.floor(Date.now() / 1000)) return false;
    return true;
  } catch {
    return false;
  }
}

function corsHeaders(origin: string | null): Record<string, string> {
  const allowed = (process.env.API_CORS_ORIGINS ?? "*")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const allowAll = allowed.includes("*");
  const allow =
    allowAll || (origin && allowed.includes(origin)) ? origin ?? "*" : "";
  if (!allow) return {};
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-API-Key, Authorization",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

// In-memory token bucket for rate limiting
type Bucket = { tokens: number; lastRefill: number };
const buckets = new Map<string, Bucket>();
const RATE_LIMIT_PER_MIN = Number(process.env.API_RATE_LIMIT_PER_MIN ?? 60);
const BUCKET_SIZE = RATE_LIMIT_PER_MIN;
const REFILL_MS = 60_000;

function rateLimit(identity: string): {
  allowed: boolean;
  retryAfter: number;
  remaining: number;
} {
  const now = Date.now();
  const b = buckets.get(identity) ?? { tokens: BUCKET_SIZE, lastRefill: now };
  const elapsed = now - b.lastRefill;
  const refill = (elapsed / REFILL_MS) * BUCKET_SIZE;
  b.tokens = Math.min(BUCKET_SIZE, b.tokens + refill);
  b.lastRefill = now;
  if (b.tokens >= 1) {
    b.tokens -= 1;
    buckets.set(identity, b);
    return { allowed: true, retryAfter: 0, remaining: Math.floor(b.tokens) };
  }
  buckets.set(identity, b);
  const retryAfter = Math.ceil(((1 - b.tokens) / BUCKET_SIZE) * REFILL_MS / 1000);
  return { allowed: false, retryAfter, remaining: 0 };
}

function identityForRateLimit(req: NextRequest): string {
  const h = req.headers.get("x-api-key");
  if (h) return `key:${h.slice(0, 12)}`;
  const a = req.headers.get("authorization");
  if (a?.startsWith("Bearer ")) return `key:${a.slice(7, 19)}`;
  if (a?.startsWith("Basic ")) return `basic:${a.slice(6, 20)}`;
  // Fallback to client IP (best-effort)
  const ip = req.headers.get("x-forwarded-for") ?? req.headers.get("x-real-ip") ?? "anon";
  return `ip:${ip.split(",")[0]!.trim()}`;
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  for (const p of EXCLUDED_PREFIXES) {
    if (pathname.startsWith(p)) return NextResponse.next();
  }

  const origin = req.headers.get("origin");
  const isApi = pathname.startsWith("/api/");
  const cors = isApi ? corsHeaders(origin) : {};

  // CORS preflight
  if (isApi && req.method === "OPTIONS") {
    return new NextResponse(null, { status: 204, headers: cors });
  }

  if (isApi) {
    // Rate limit only — auth is in each route handler via requireAuth().
    const identity = identityForRateLimit(req);
    const rl = rateLimit(identity);
    if (!rl.allowed) {
      return new NextResponse(
        JSON.stringify({
          error: `Rate limit exceeded. Retry in ${rl.retryAfter}s.`,
        }),
        {
          status: 429,
          headers: {
            "Content-Type": "application/json",
            "Retry-After": String(rl.retryAfter),
            "X-RateLimit-Limit": String(RATE_LIMIT_PER_MIN),
            "X-RateLimit-Remaining": "0",
            ...cors,
          },
        }
      );
    }
    const r = NextResponse.next();
    for (const [k, v] of Object.entries(cors)) r.headers.set(k, v);
    r.headers.set("X-RateLimit-Limit", String(RATE_LIMIT_PER_MIN));
    r.headers.set("X-RateLimit-Remaining", String(rl.remaining));
    return r;
  }

  // Non-API pages — require a valid session cookie. Basic Auth is NOT
  // accepted on browser pages once SESSION_SECRET is configured;
  // operators sign in through /login like everyone else.
  const sessionCookie = req.cookies.get(SESSION_COOKIE)?.value;
  if (await verifySessionToken(sessionCookie)) {
    return NextResponse.next();
  }

  // Legacy fallback: ONLY if SESSION_SECRET is unset (pre-migration
  // deployment without real auth). Keeps old basic-auth-only
  // installs working but doesn't let a stale BASIC_AUTH_PASS bypass
  // the new cookie gate on a properly-configured install.
  if (!process.env.SESSION_SECRET && process.env.BASIC_AUTH_PASS) {
    const header = req.headers.get("authorization");
    const user = process.env.BASIC_AUTH_USER ?? "research";
    const expected = "Basic " + btoa(`${user}:${process.env.BASIC_AUTH_PASS}`);
    if (header === expected) return NextResponse.next();
  }

  const loginUrl = new URL("/login", req.url);
  loginUrl.searchParams.set("next", pathname);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon).*)"],
};
