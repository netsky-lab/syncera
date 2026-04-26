// POST /api/auth/password-reset-confirm — body: { token, new_password }.
// Verifies the signed password-reset token, writes the new password,
// returns a session cookie so the user lands logged in.

import { verifyToken } from "@/lib/auth-tokens";
import {
  findUserById,
  setPasswordByUid,
  markEmailVerified,
} from "@/lib/users";
import { signSession, sessionCookieHeader } from "@/lib/sessions";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const token = String(body.token ?? "");
  const newPassword = String(body.new_password ?? "");
  const payload = verifyToken(token, "password_reset");
  if (!payload) {
    return Response.json(
      { error: "Invalid or expired reset link" },
      { status: 400 }
    );
  }
  const user = findUserById(payload.uid);
  if (!user) {
    return Response.json({ error: "User not found" }, { status: 404 });
  }
  const res = setPasswordByUid(user.id, newPassword);
  if (!res.ok) {
    return Response.json({ error: res.error }, { status: 400 });
  }
  // Bonus: reset confirms control of the email box → mark it verified
  // in case the user never clicked the signup-confirm link but can
  // receive the reset-email now.
  markEmailVerified(user.id);
  const session = signSession(user.id);
  const isSecure = request.url.startsWith("https://");
  return Response.json(
    { ok: true },
    { headers: { "Set-Cookie": sessionCookieHeader(session, isSecure) } }
  );
}
