import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Dual-auth gate:
//   /api/*  paths accept either Basic Auth (same as browser) OR an API key
//           via `X-API-Key: <key>` or `Authorization: Bearer <key>`.
//           API_KEYS=key1,key2 env var enumerates accepted keys.
//
//   Other paths accept Basic Auth only (human browsers).
//
//   /_next/*, /favicon, /api/health bypass auth entirely.
//
// Configure:
//   BASIC_AUTH_USER   username (default: research)
//   BASIC_AUTH_PASS   required basic-auth password; unset disables auth
//   API_KEYS          comma-separated list of API keys; unset means no
//                     keys accepted (API still reachable via basic auth)

const EXCLUDED_PREFIXES = [
  "/_next/",
  "/favicon",
  "/api/health",
];

function apiKeyFromRequest(req: NextRequest): string | null {
  const headerKey = req.headers.get("x-api-key");
  if (headerKey) return headerKey;
  const auth = req.headers.get("authorization");
  if (auth?.startsWith("Bearer ")) return auth.slice(7);
  return null;
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  for (const p of EXCLUDED_PREFIXES) {
    if (pathname.startsWith(p)) return NextResponse.next();
  }

  const pass = process.env.BASIC_AUTH_PASS;
  if (!pass && !process.env.API_KEYS) {
    return NextResponse.next(); // auth entirely disabled
  }

  // Try API key first on /api/* routes — stateless, better for programmatic clients.
  if (pathname.startsWith("/api/")) {
    const validKeys = (process.env.API_KEYS ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const presentedKey = apiKeyFromRequest(req);
    if (presentedKey && validKeys.includes(presentedKey)) {
      return NextResponse.next();
    }
    // If no API key presented but basic auth header is present, allow basic auth through
    // (this keeps the browser UI's /api/runs/* etc working)
    const authHeader = req.headers.get("authorization");
    if (pass && authHeader?.startsWith("Basic ")) {
      const user = process.env.BASIC_AUTH_USER ?? "research";
      const expected = "Basic " + btoa(`${user}:${pass}`);
      if (authHeader === expected) return NextResponse.next();
    }
    // Neither worked — fail specifically with a JSON message for APIs
    return new NextResponse(
      JSON.stringify({ error: "Unauthorized — provide X-API-Key header or Basic auth credentials" }),
      {
        status: 401,
        headers: {
          "Content-Type": "application/json",
          "WWW-Authenticate": `Basic realm="Research Lab API", charset="UTF-8"`,
        },
      }
    );
  }

  // Non-API routes — basic auth only (browser UI)
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
