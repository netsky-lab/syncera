// GET /api/auth/verify?token=<signed-token> — confirmation link from
// the signup email. On success marks email_verified=true, sets a
// session cookie, and redirects to /.

import { verifyToken } from "@/lib/auth-tokens";
import { findUserById, markEmailVerified } from "@/lib/users";
import { signSession, sessionCookieHeader } from "@/lib/sessions";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const token = url.searchParams.get("token");
  const payload = verifyToken(token, "verify_email");
  if (!payload) {
    return new Response(
      `<html><body style="font-family:sans-serif;background:#0c0c0d;color:#ededf0;padding:40px;text-align:center;"><h1>Invalid or expired link</h1><p>Request a new confirmation email from <a href="/login" style="color:#e8a584;">the login page</a>.</p></body></html>`,
      {
        status: 400,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      }
    );
  }
  const user = findUserById(payload.uid);
  if (!user) {
    return new Response("User not found", { status: 404 });
  }
  markEmailVerified(user.id);
  const session = signSession(user.id);
  const isSecure = request.url.startsWith("https://");
  // 303 See Other — browser follows with GET, drops token from the URL
  return new Response(null, {
    status: 303,
    headers: {
      Location: "/",
      "Set-Cookie": sessionCookieHeader(session, isSecure),
    },
  });
}
