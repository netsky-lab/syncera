import { getOwner } from "@/lib/projects";
import { requireAuth, viewerUidFromRequest } from "@/lib/auth";
import { findUserById } from "@/lib/users";
import { setDebtStatus, type DebtStatus } from "@/lib/debt";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const VALID = new Set<DebtStatus>(["open", "running", "resolved", "dismissed"]);

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ slug: string; debtId: string }> }
) {
  const auth = requireAuth(request);
  if (!auth.ok) return auth.response;
  const { slug, debtId } = await params;
  const viewerUid = viewerUidFromRequest(request);
  const owner = getOwner(slug);
  const viewerIsAdmin = viewerUid
    ? findUserById(viewerUid)?.role === "admin"
    : false;
  const isOwner = owner != null && viewerUid != null && owner === viewerUid;
  if (!isOwner && !viewerIsAdmin) {
    return Response.json(
      { error: "Only the project owner or an admin can update debt status" },
      { status: 403 }
    );
  }

  const body = await request.json().catch(() => ({}));
  const status = String(body.status ?? "") as DebtStatus;
  if (!VALID.has(status)) {
    return Response.json(
      { error: "status must be one of: open, running, resolved, dismissed" },
      { status: 400 }
    );
  }

  const statuses = setDebtStatus(
    slug,
    debtId,
    {
      status,
      note: body.note == null ? null : String(body.note),
      branch_slug: body.branch_slug == null ? null : String(body.branch_slug),
    },
    viewerUid
  );
  return Response.json({ ok: true, debt_id: debtId, record: statuses[debtId] });
}
