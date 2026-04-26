import { authenticate, ensureAdminSeed, findUserByEmail } from "@/lib/users";
import { signSession, sessionCookieHeader } from "@/lib/sessions";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  ensureAdminSeed();
  const body = await request.json().catch(() => ({}));
  const email = String(body.email ?? "").trim();
  const password = String(body.password ?? "");
  if (!email || !password) {
    return Response.json({ error: "Email and password required" }, { status: 400 });
  }
  const result = authenticate(email, password);
  if (!result.ok) {
    return Response.json({ error: "Invalid credentials" }, { status: 401 });
  }
  // Gate login on email verification — but treat missing field as
  // verified for back-compat with accounts created before the flag
  // existed. New accounts always have it explicitly set.
  const fullUser = findUserByEmail(email);
  const verified = fullUser?.email_verified !== false; // undefined → treat as verified
  if (!verified) {
    return Response.json(
      {
        error:
          "Please confirm your email first. Check your inbox for the link we sent when you signed up.",
        unverified: true,
      },
      { status: 403 }
    );
  }
  const token = signSession(result.user.id);
  const isSecure = request.url.startsWith("https://");
  return Response.json(
    { user: result.user },
    {
      headers: {
        "Set-Cookie": sessionCookieHeader(token, isSecure),
      },
    }
  );
}
