import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Dual-auth gate + CORS + token-bucket rate limit for /api/* routes.
//
//   /api/*  accepts X-API-Key: <key> or Authorization: Bearer <key>
//           or Basic Auth. API_KEYS=k1,k2 in env lists accepted keys.
//           CORS preflight (OPTIONS) bypasses auth. CORS response headers
//           always added if request has Origin. Rate limit: 60 req/min per
//           API key or IP (token bucket, in-memory — survives only per
//           server process).
//
//   Other paths accept Basic Auth only (human browser UI).
//
//   /_next/*, /favicon, /api/health bypass auth entirely.
//
// Env:
//   BASIC_AUTH_USER / BASIC_AUTH_PASS  — human browser auth
//   API_KEYS                           — comma-separated programmatic keys
//   API_CORS_ORIGINS                   — comma-separated allowed origins
//                                         (default: "*" which is permissive;
//                                          for production pin to the
//                                          consumer's domain)
//   API_RATE_LIMIT_PER_MIN             — requests/min per identity, default 60

const EXCLUDED_PREFIXES = ["/_next/", "/favicon", "/api/health"];

function apiKeyFromRequest(req: NextRequest): string | null {
  const headerKey = req.headers.get("x-api-key");
  if (headerKey) return headerKey;
  const auth = req.headers.get("authorization");
  if (auth?.startsWith("Bearer ")) return auth.slice(7);
  return null;
}

// --- CORS ---
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
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-API-Key, Authorization",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

// --- Rate limit (in-memory token bucket, per identity) ---
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

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  for (const p of EXCLUDED_PREFIXES) {
    if (pathname.startsWith(p)) return NextResponse.next();
  }

  const origin = req.headers.get("origin");
  const isApi = pathname.startsWith("/api/");
  const cors = isApi ? corsHeaders(origin) : {};

  // CORS preflight short-circuits auth
  if (isApi && req.method === "OPTIONS") {
    return new NextResponse(null, { status: 204, headers: cors });
  }

  const pass = process.env.BASIC_AUTH_PASS;
  if (!pass && !process.env.API_KEYS) {
    const r = NextResponse.next();
    for (const [k, v] of Object.entries(cors)) r.headers.set(k, v);
    return r;
  }

  if (isApi) {
    const validKeys = (process.env.API_KEYS ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const presentedKey = apiKeyFromRequest(req);
    let identity: string | null = null;

    if (presentedKey && validKeys.includes(presentedKey)) {
      identity = `key:${presentedKey.slice(0, 8)}`;
    } else {
      const authHeader = req.headers.get("authorization");
      if (pass && authHeader?.startsWith("Basic ")) {
        const user = process.env.BASIC_AUTH_USER ?? "research";
        const expected = "Basic " + btoa(`${user}:${pass}`);
        if (authHeader === expected) identity = "basic";
      }
    }

    if (!identity) {
      return new NextResponse(
        JSON.stringify({
          error:
            "Unauthorized — provide X-API-Key header or Basic auth credentials",
        }),
        {
          status: 401,
          headers: {
            "Content-Type": "application/json",
            "WWW-Authenticate": `Basic realm="Research Lab API", charset="UTF-8"`,
            ...cors,
          },
        }
      );
    }

    const rl = rateLimit(identity);
    if (!rl.allowed) {
      return new NextResponse(
        JSON.stringify({
          error: `Rate limit exceeded (${RATE_LIMIT_PER_MIN} req/min per key). Retry in ${rl.retryAfter}s.`,
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

  // Non-API routes — basic auth only
  if (!pass) return NextResponse.next();
  const header = req.headers.get("authorization");
  const user = process.env.BASIC_AUTH_USER ?? "research";
  const expected = "Basic " + btoa(`${user}:${pass}`);
  if (header === expected) return NextResponse.next();

  return new NextResponse("Authentication required", {
    status: 401,
    headers: {
      "WWW-Authenticate": `Basic realm="Research Lab", charset="UTF-8"`,
    },
  });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon).*)"],
};
