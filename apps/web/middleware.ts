import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Minimal HTTP Basic Auth middleware. Gates the entire app behind a single
// shared credential pair taken from env vars.
//
// Configure via:
//   BASIC_AUTH_USER  — username (default: "research")
//   BASIC_AUTH_PASS  — required; if unset, auth is disabled (dev mode)
//
// Browser prompts once per session; no login page, no database, no cookies.
// If someone leaks the password just rotate the env var and restart.

const EXCLUDED_PREFIXES = [
  "/_next/",
  "/favicon",
  "/api/health",
];

export function middleware(req: NextRequest) {
  const pass = process.env.BASIC_AUTH_PASS;
  if (!pass) return NextResponse.next(); // auth disabled

  const { pathname } = req.nextUrl;
  for (const p of EXCLUDED_PREFIXES) {
    if (pathname.startsWith(p)) return NextResponse.next();
  }

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
  // Everything except Next internals and static assets
  matcher: ["/((?!_next/static|_next/image|favicon).*)"],
};
