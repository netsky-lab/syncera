// GET/POST/DELETE /api/projects/:slug/share — manage share-tokens that
// grant read-only public access to a project. Owner or admin only.

import {
  createShareToken,
  listShareTokens,
  revokeShareToken,
} from "@/lib/share-tokens";
import { getOwner, canView } from "@/lib/projects";
import { findUserById } from "@/lib/users";
import { cookies } from "next/headers";
import { verifySessionUser, COOKIE_NAME } from "@/lib/sessions";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function requireProjectOwnerOrAdmin(
  slug: string
): Promise<{ ok: true; uid: string } | { ok: false; response: Response }> {
  const jar = await cookies();
  const uid = verifySessionUser(jar.get(COOKIE_NAME)?.value)?.uid ?? null;
  if (!uid) {
    return {
      ok: false,
      response: Response.json({ error: "Sign in required" }, { status: 401 }),
    };
  }
  if (!canView(slug, uid)) {
    return {
      ok: false,
      response: Response.json({ error: "Not found" }, { status: 404 }),
    };
  }
  const owner = getOwner(slug);
  const user = findUserById(uid);
  const isOwner = owner && owner === uid;
  const isAdmin = user?.role === "admin";
  if (!isOwner && !isAdmin) {
    return {
      ok: false,
      response: Response.json(
        { error: "Only the owner or an admin can manage share links" },
        { status: 403 }
      ),
    };
  }
  return { ok: true, uid };
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const auth = await requireProjectOwnerOrAdmin(slug);
  if (!auth.ok) return auth.response;
  return Response.json({ tokens: listShareTokens(slug) });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const auth = await requireProjectOwnerOrAdmin(slug);
  if (!auth.ok) return auth.response;
  const entry = createShareToken(slug, auth.uid);
  return Response.json({ ok: true, token: entry });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const auth = await requireProjectOwnerOrAdmin(slug);
  if (!auth.ok) return auth.response;
  const body = await request.json().catch(() => ({}));
  const token = String(body.token ?? "");
  if (!token) {
    return Response.json({ error: "token required" }, { status: 400 });
  }
  const ok = revokeShareToken(token);
  return Response.json({ ok });
}
