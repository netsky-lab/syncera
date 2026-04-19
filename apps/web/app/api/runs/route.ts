// GET /api/runs — list of pipeline runs known to this server process.
// In-memory; restarts wipe history. For persistent history read
// /projects/<slug>/runs/ on disk.

import { listRuns } from "@/lib/runner";
import { requireAuth } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const auth = requireAuth(request);
  if (!auth.ok) return auth.response;
  const runs = listRuns();
  return Response.json({
    count: runs.length,
    active: runs.filter((r) => r.status === "running").length,
    runs,
  });
}
