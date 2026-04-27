// Revoke a key — caller must own it. Admins use /api/admin/keys/[id]
// for god-revoke of anyone's keys.

import { revokeKey, listKeys } from "@/lib/keys";
import { cookies } from "next/headers";
import { verifySessionUser, COOKIE_NAME } from "@/lib/sessions";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const jar = await cookies();
  const uid = verifySessionUser(jar.get(COOKIE_NAME)?.value)?.uid ?? null;
  if (!uid) {
    return Response.json(
      { error: "Sign in required" },
      { status: 401 }
    );
  }
  const { id } = await params;
  const key = listKeys().find((k) => k.id === id);
  if (!key) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  if (key.owner_uid !== uid) {
    return Response.json(
      { error: "You can only revoke keys you created" },
      { status: 403 }
    );
  }
  const ok = revokeKey(id);
  if (!ok) return Response.json({ error: "Revoke failed" }, { status: 500 });
  return Response.json({ ok: true, revoked: id });
}
