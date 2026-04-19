import { revokeKey } from "@/lib/keys";
import { requireBasicAuth } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = requireBasicAuth(request);
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const ok = revokeKey(id);
  if (!ok) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json({ ok: true, revoked: id });
}
