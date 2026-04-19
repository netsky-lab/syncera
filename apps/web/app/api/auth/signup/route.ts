import { createUser, listUsers } from "@/lib/users";
import { signSession, sessionCookieHeader } from "@/lib/sessions";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// POST /api/auth/signup — open signup gated by ALLOW_SIGNUP=1.
// When signup is closed (default), this returns 403 unless the store
// is empty (first user) — bootstraps the first admin via UI if the
// operator skipped ADMIN_EMAIL/ADMIN_PASSWORD env.

export async function POST(request: Request) {
  const existing = listUsers();
  const signupOpen = process.env.ALLOW_SIGNUP === "1";
  const isBootstrap = existing.length === 0;
  if (!signupOpen && !isBootstrap) {
    return Response.json(
      { error: "Signup is closed. Contact an admin for an account." },
      { status: 403 }
    );
  }
  const body = await request.json().catch(() => ({}));
  const email = String(body.email ?? "").trim();
  const password = String(body.password ?? "");
  const role = isBootstrap ? "admin" : "user";
  const result = createUser({ email, password, role });
  if (!result.ok) {
    return Response.json({ error: result.error }, { status: 400 });
  }
  const token = signSession(result.user.id);
  const isSecure = request.url.startsWith("https://");
  return Response.json(
    { user: result.user },
    {
      status: 201,
      headers: { "Set-Cookie": sessionCookieHeader(token, isSecure) },
    }
  );
}
