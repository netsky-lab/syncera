// POST /api/runs/:id/cancel — kill a running pipeline. Owner or admin only.

import { cancelRun, getRunMeta } from "@/lib/runner";
import { requireAuth, viewerUidFromRequest } from "@/lib/auth";
import { findUserById } from "@/lib/users";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = requireAuth(request);
  if (!auth.ok) return auth.response;
  const { id } = await params;

  // getRunMeta covers both in-memory runs and disk-only runs (after a
  // web container restart, the sibling pipeline container is still alive
  // but we've lost the ActiveRun object).
  const run = getRunMeta(id);
  if (!run) return Response.json({ error: "Run not found" }, { status: 404 });

  // Authorization: owner or admin.
  const viewerUid = viewerUidFromRequest(request);
  const viewerIsAdmin = viewerUid
    ? findUserById(viewerUid)?.role === "admin"
    : false;
  const isOwner = run.ownerUid != null && run.ownerUid === viewerUid;
  if (!viewerIsAdmin && !isOwner) {
    return Response.json(
      { error: "Only the run owner or an admin can cancel" },
      { status: 403 }
    );
  }

  const res = await cancelRun(id);
  if (!res.ok) {
    return Response.json({ error: res.reason ?? "Cancel failed" }, { status: 400 });
  }
  return Response.json({ ok: true });
}
