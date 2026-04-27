// DELETE /api/projects/:slug/tweak/:variantId — remove a saved section
// variant. Owner-or-admin only. The canonical REPORT.md is never
// affected; this just cleans up the variants/ directory.

import { getOwner, canView } from "@/lib/projects";
import { findUserById } from "@/lib/users";
import { cookies } from "next/headers";
import { verifySessionUser, COOKIE_NAME } from "@/lib/sessions";
import { existsSync, unlinkSync } from "fs";
import { join } from "path";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function projectsDir(): string {
  if (process.env.PROJECTS_DIR) return process.env.PROJECTS_DIR;
  const cwdProjects = join(process.cwd(), "projects");
  if (existsSync(cwdProjects)) return cwdProjects;
  return join(process.cwd(), "..", "..", "projects");
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ slug: string; variantId: string }> }
) {
  const jar = await cookies();
  const uid = verifySessionUser(jar.get(COOKIE_NAME)?.value)?.uid ?? null;
  if (!uid) {
    return Response.json({ error: "Sign in required" }, { status: 401 });
  }
  const { slug, variantId } = await params;
  if (!canView(slug, uid)) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  const owner = getOwner(slug);
  const user = findUserById(uid);
  const isOwner = owner && owner === uid;
  const isAdmin = user?.role === "admin";
  if (!isOwner && !isAdmin) {
    return Response.json(
      { error: "Only the project owner or an admin can delete variants" },
      { status: 403 }
    );
  }

  // Sanitize — variantId shape is <section>_<ts>; reject anything that
  // escapes the variants dir.
  if (!/^[a-z0-9_-]+$/.test(variantId)) {
    return Response.json({ error: "Invalid variant id" }, { status: 400 });
  }

  const filePath = join(projectsDir(), slug, "variants", `${variantId}.json`);
  if (!existsSync(filePath)) {
    return Response.json({ error: "Variant not found" }, { status: 404 });
  }
  try {
    unlinkSync(filePath);
  } catch (err: any) {
    return Response.json(
      { error: `Delete failed: ${err?.message ?? String(err)}` },
      { status: 500 }
    );
  }
  return Response.json({ ok: true, deleted: variantId });
}
