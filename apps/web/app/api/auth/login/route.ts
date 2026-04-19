import { authenticate, ensureAdminSeed } from "@/lib/users";
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
