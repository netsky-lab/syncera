import { updatePassword } from "@/lib/users";
import { verifySession, COOKIE_NAME } from "@/lib/sessions";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  const cookie = request.headers.get("cookie") ?? "";
  const match = cookie.match(new RegExp(`(?:^|;\\s*)${COOKIE_NAME}=([^;]+)`));
  const session = verifySession(match?.[1]);
  if (!session) {
    return Response.json({ error: "Not signed in" }, { status: 401 });
  }
  const body = await request.json().catch(() => ({}));
  const current = String(body.current ?? "");
  const next = String(body.next ?? "");
  if (!current || !next) {
    return Response.json({ error: "current and next required" }, { status: 400 });
  }
  const result = updatePassword(session.uid, current, next);
  if (!result.ok) return Response.json({ error: result.error }, { status: 400 });
  return Response.json({ ok: true });
}
