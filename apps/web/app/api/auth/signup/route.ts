import { createUser, ensureAdminSeed, listUsers } from "@/lib/users";
import { signSession, sessionCookieHeader, isSecureRequest } from "@/lib/sessions";
import { signToken } from "@/lib/auth-tokens";
import { sendEmail, emailShell, appBaseUrl } from "@/lib/email";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// POST /api/auth/signup — open signup gated by ALLOW_SIGNUP=1.
// When signup is closed (default), this returns 403 unless the store
// is empty (first user) — bootstraps the first admin via UI if the
// operator skipped ADMIN_EMAIL/ADMIN_PASSWORD env.
//
// Flow:
//   - First user (bootstrap) OR RESEND_API_KEY missing → auto-verified,
//     auto-login (session cookie). Useful for dev and the initial admin.
//   - Otherwise → user created with email_verified=false, confirmation
//     link emailed. Login is blocked until they click the link.

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  ensureAdminSeed();
  const existing = listUsers();
  const signupOpen = process.env.ALLOW_SIGNUP === "1";
  const isBootstrap = existing.length === 0;
  const bootstrapToken =
    request.headers.get("x-bootstrap-token") ||
    String(body.bootstrap_token ?? "");
  const requiredBootstrapToken = process.env.BOOTSTRAP_TOKEN;
  if (
    isBootstrap &&
    process.env.NODE_ENV === "production" &&
    requiredBootstrapToken &&
    bootstrapToken !== requiredBootstrapToken
  ) {
    return Response.json(
      { error: "Bootstrap token required for first admin signup." },
      { status: 403 }
    );
  }
  if (
    isBootstrap &&
    process.env.NODE_ENV === "production" &&
    !requiredBootstrapToken &&
    (!process.env.ADMIN_EMAIL || !process.env.ADMIN_PASSWORD)
  ) {
    return Response.json(
      {
        error:
          "First admin signup is disabled in production unless BOOTSTRAP_TOKEN or ADMIN_EMAIL/ADMIN_PASSWORD is configured.",
      },
      { status: 403 }
    );
  }
  if (!signupOpen && !isBootstrap) {
    return Response.json(
      { error: "Signup is closed. Contact an admin for an account." },
      { status: 403 }
    );
  }
  const email = String(body.email ?? "").trim();
  const password = String(body.password ?? "");
  const role = isBootstrap ? "admin" : "user";

  const emailConfigured = !!process.env.RESEND_API_KEY;
  // Skip verification for bootstrap admin OR if email sending isn't
  // configured — we don't want signup flow to dead-end on a missing
  // API key.
  const skipVerification = isBootstrap || !emailConfigured;

  const result = createUser({
    email,
    password,
    role,
    emailVerified: skipVerification,
  });
  if (!result.ok) {
    return Response.json({ error: result.error }, { status: 400 });
  }

  if (skipVerification) {
    const token = signSession(result.user.id, result.user.session_version ?? 0);
    return Response.json(
      { user: result.user, verified: true },
      {
        status: 201,
        headers: { "Set-Cookie": sessionCookieHeader(token, isSecureRequest(request)) },
      }
    );
  }

  // Send confirmation email. 2-day TTL — plenty of time to click from
  // any client, including forwarded-to-phone cases.
  const verifyToken = signToken(
    { uid: result.user.id, kind: "verify_email" },
    60 * 60 * 48
  );
  const link = `${appBaseUrl()}/api/auth/verify?token=${encodeURIComponent(verifyToken)}`;
  const send = await sendEmail({
    to: result.user.email,
    subject: "Confirm your Syncera account",
    html: emailShell({
      heading: "Confirm your email",
      body: `You're almost done. Click the button to activate your Syncera account and start kicking off research runs.`,
      cta: { label: "Confirm email", href: link },
      footer: "If you didn't request this, ignore the email.",
    }),
    text: `Confirm your Syncera account by opening this link:\n\n${link}\n\nIf you didn't sign up, ignore this email.`,
  });
  if (!send.ok) {
    // Email couldn't be sent — we still return 201 (account exists) but
    // flag so the UI can show "we couldn't email you, contact support".
    return Response.json(
      {
        user: result.user,
        verified: false,
        email_sent: false,
        error: `Account created but confirmation email failed: ${send.error}`,
      },
      { status: 201 }
    );
  }
  return Response.json(
    { user: result.user, verified: false, email_sent: true },
    { status: 201 }
  );
}
