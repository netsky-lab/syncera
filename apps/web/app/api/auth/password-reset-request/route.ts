// POST /api/auth/password-reset-request — user submits their email,
// we send a reset link if the email matches a known account. Returns
// 200 whether the email exists or not (don't leak account existence).

import { findUserByEmail } from "@/lib/users";
import { signToken } from "@/lib/auth-tokens";
import { sendEmail, emailShell, appBaseUrl } from "@/lib/email";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const email = String(body.email ?? "").trim();
  if (!email || !/^[^@]+@[^@]+\.[^@]+$/.test(email)) {
    return Response.json({ error: "Invalid email" }, { status: 400 });
  }
  const user = findUserByEmail(email);
  // Silent success on no-match: don't leak which emails are registered.
  if (!user) {
    return Response.json({ ok: true });
  }

  if (!process.env.RESEND_API_KEY) {
    return Response.json(
      { error: "Email is not configured on this deployment — contact admin" },
      { status: 500 }
    );
  }

  // 1-hour TTL — reset is time-sensitive, shorter than verify.
  const token = signToken(
    { uid: user.id, kind: "password_reset", sv: user.session_version ?? 0 },
    60 * 60
  );
  const link = `${appBaseUrl()}/reset-password?token=${encodeURIComponent(token)}`;
  const send = await sendEmail({
    to: user.email,
    subject: "Reset your Syncera password",
    html: emailShell({
      heading: "Password reset",
      body: `Click below to set a new password. This link expires in 1 hour.`,
      cta: { label: "Reset password", href: link },
      footer:
        "If you didn't request this, you can ignore the email — your password stays the same.",
    }),
    text: `Reset your Syncera password by opening this link (expires in 1 hour):\n\n${link}\n\nIf you didn't request this, ignore the email.`,
  });
  if (!send.ok) {
    return Response.json(
      { error: `Failed to send reset email: ${send.error}` },
      { status: 502 }
    );
  }
  return Response.json({ ok: true });
}
