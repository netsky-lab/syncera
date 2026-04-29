// GET /api/runs — list pipeline runs visible to the current user.
// Combines live process state with persisted projects/<slug>/runs metadata.

import { listRuns } from "@/lib/runner";
import { requireAuth, viewerUidFromRequest } from "@/lib/auth";
import { findUserById } from "@/lib/users";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const auth = requireAuth(request);
  if (!auth.ok) return auth.response;
  const viewerUid = viewerUidFromRequest(request);
  const viewerIsAdmin = viewerUid
    ? findUserById(viewerUid)?.role === "admin"
    : false;
  const runs = listRuns(viewerUid, viewerIsAdmin);
  return Response.json({
    count: runs.length,
    active: runs.filter((r) => r.status === "running").length,
    runs,
  });
}
