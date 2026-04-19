import { verifySession, COOKIE_NAME } from "@/lib/sessions";
import { findUserById } from "@/lib/users";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const cookie = request.headers.get("cookie") ?? "";
  const match = cookie.match(new RegExp(`(?:^|;\\s*)${COOKIE_NAME}=([^;]+)`));
  const token = match?.[1];
  const session = verifySession(token);
  if (!session) {
    return Response.json({ user: null }, { status: 200 });
  }
  const user = findUserById(session.uid);
  if (!user) return Response.json({ user: null }, { status: 200 });
  const { password_hash, ...rest } = user;
  return Response.json({ user: rest });
}
