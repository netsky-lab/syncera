import { deleteUser, findUserById, listUsers } from "@/lib/users";
import { requireBasicAuth } from "@/lib/auth";
import { verifySession, COOKIE_NAME } from "@/lib/sessions";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = requireBasicAuth(request);
  if (!auth.ok) return auth.response;
  const { id } = await params;

  // Identify the caller from the session cookie to prevent self-delete.
  const cookie = request.headers.get("cookie") ?? "";
  const match = cookie.match(new RegExp(`(?:^|;\\s*)${COOKIE_NAME}=([^;]+)`));
  const session = verifySession(match?.[1]);
  if (session?.uid === id) {
    return Response.json(
      { error: "You cannot delete your own account while signed in." },
      { status: 400 }
    );
  }

  // Prevent deleting the last admin — leaves no one to manage the system.
  const target = findUserById(id);
  if (target?.role === "admin") {
    const admins = listUsers().filter((u) => u.role === "admin");
    if (admins.length <= 1) {
      return Response.json(
        { error: "Cannot delete the last admin account." },
        { status: 400 }
      );
    }
  }

  const ok = deleteUser(id);
  if (!ok) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json({ ok: true });
}
