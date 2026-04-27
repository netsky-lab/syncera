// POST /api/projects/:slug/tweak/:variantId/promote — bake a section
// variant into the canonical REPORT.md. Useful after the user picks
// their preferred rewrite and wants downstream consumers (PDF export,
// shared link, Download .md) to reflect the choice.
//
// After a successful promote the variant is deleted — it IS the default
// now, no need to keep a duplicate around.

import { getOwner, canView } from "@/lib/projects";
import { findUserById } from "@/lib/users";
import { cookies } from "next/headers";
import { verifySessionUser, COOKIE_NAME } from "@/lib/sessions";
import {
  existsSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
} from "fs";
import { join } from "path";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Section-name → H2 heading in REPORT.md. Keep in sync with
// src/synthesizer.ts, which is the only place that writes those
// headings.
const HEADING_BY_SECTION: Record<string, string> = {
  introduction: "Introduction",
  summary: "Summary",
  comparison: "Method Comparison",
  deployment: "Deployment Sequence",
  recommendation: "Recommendation",
};

function projectsDir(): string {
  if (process.env.PROJECTS_DIR) return process.env.PROJECTS_DIR;
  const cwdProjects = join(process.cwd(), "projects");
  if (existsSync(cwdProjects)) return cwdProjects;
  return join(process.cwd(), "..", "..", "projects");
}

// Replace the body of "## <heading>" in markdown with newBody. Body runs
// from the first non-heading line after the "## heading" until the next
// "## " or EOF. Returns the new markdown, or null if heading wasn't found.
function replaceSection(
  md: string,
  heading: string,
  newBody: string
): string | null {
  const lines = md.split("\n");
  // Find heading line index.
  const headingRe = new RegExp(`^##\\s+${heading}\\s*$`, "i");
  const startIdx = lines.findIndex((l) => headingRe.test(l));
  if (startIdx === -1) return null;
  // Body starts one line after the heading (we keep a blank separator).
  // Find where the next "## " begins.
  let endIdx = lines.length;
  for (let i = startIdx + 1; i < lines.length; i++) {
    if (/^##\s+/.test(lines[i]!)) {
      endIdx = i;
      break;
    }
  }
  const before = lines.slice(0, startIdx + 1);
  const after = lines.slice(endIdx);
  const body = newBody.replace(/\s+$/, "") + "\n";
  // Keep one blank line between heading and body, and between body and
  // next section, to match synthesizer's assembly style.
  return [...before, "", body, ...after].join("\n");
}

export async function POST(
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
      { error: "Only the project owner or an admin can promote variants" },
      { status: 403 }
    );
  }
  if (!/^[a-z0-9_-]+$/.test(variantId)) {
    return Response.json({ error: "Invalid variant id" }, { status: 400 });
  }

  const variantPath = join(projectsDir(), slug, "variants", `${variantId}.json`);
  if (!existsSync(variantPath)) {
    return Response.json({ error: "Variant not found" }, { status: 404 });
  }
  const reportPath = join(projectsDir(), slug, "REPORT.md");
  if (!existsSync(reportPath)) {
    return Response.json(
      { error: "REPORT.md doesn't exist yet — wait for pipeline to finish" },
      { status: 400 }
    );
  }

  let variant: any;
  try {
    variant = JSON.parse(readFileSync(variantPath, "utf-8"));
  } catch {
    return Response.json({ error: "Variant file corrupt" }, { status: 500 });
  }

  const heading = HEADING_BY_SECTION[variant.section];
  if (!heading) {
    return Response.json(
      { error: `Section "${variant.section}" cannot be promoted` },
      { status: 400 }
    );
  }

  const originalMd = readFileSync(reportPath, "utf-8");
  const newMd = replaceSection(originalMd, heading, String(variant.content ?? ""));
  if (newMd == null) {
    return Response.json(
      {
        error: `Heading "## ${heading}" not found in REPORT.md — can't promote`,
      },
      { status: 400 }
    );
  }

  try {
    // Snapshot the pre-promote report so a user can diff or rollback
    // if the replace turned out wrong. Kept alongside variants/.
    const backupDir = join(projectsDir(), slug, "variants");
    writeFileSync(
      join(backupDir, `_report_backup_${Date.now()}.md`),
      originalMd
    );
    writeFileSync(reportPath, newMd);
    // Variant is now the default — remove the side file so the switcher
    // doesn't offer a duplicate of what's already in REPORT.md.
    unlinkSync(variantPath);
  } catch (err: any) {
    return Response.json(
      { error: `Promote write failed: ${err?.message ?? String(err)}` },
      { status: 500 }
    );
  }

  return Response.json({
    ok: true,
    section: variant.section,
    heading,
  });
}
