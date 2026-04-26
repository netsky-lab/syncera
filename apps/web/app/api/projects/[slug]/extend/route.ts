// POST /api/projects/:slug/extend — start a new research that inherits
// the source project's harvest + facts + sources and re-runs planner →
// (optional) harvest → evidence → verify → analyze → synth against an
// extended topic.
//
// Mental model: "this research PLUS this additional angle → new report".
// User gets a second report grounded in the same evidence pool but with
// a different analytical frame, without paying another 20-30 min of
// harvest.
//
// Copy semantics (runs before pipeline spawn):
//   - plan.json     → NOT copied (pipeline regenerates with --replan so
//                      the new angle reshapes the question tree)
//   - scout_digest.json → copied (scout calibration still valid)
//   - facts.json        → NOT copied (evidence re-extracts over the new
//                      plan; we keep sources/ so harvest can be cached)
//   - verification.json → NOT copied
//   - sources/          → copied (expensive harvest artifact)
//   - REPORT.md / analysis_report.json → NOT copied (regenerated)
//
// Flags passed to pipeline: --replan --re-evidence --re-verify
// --re-analyze --re-synth  (everything downstream of plan regens;
// harvest is cached by presence of sources/index.json unless the planner
// generates brand-new subquestions that need fresh queries).

import { getProject, canView, setOwner } from "@/lib/projects";
import { cookies } from "next/headers";
import { verifySession, COOKIE_NAME } from "@/lib/sessions";
import { startRun } from "@/lib/runner";
import { setDebtStatus } from "@/lib/debt";
import {
  mkdirSync,
  existsSync,
  cpSync,
  writeFileSync,
} from "fs";
import { join } from "path";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

function projectsDir(): string {
  return process.env.PROJECTS_DIR ?? "/app/projects";
}

function slugifyName(name: string, fallback: string): string {
  const base = (name || fallback)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return base || fallback;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const jar = await cookies();
  const uid = verifySession(jar.get(COOKIE_NAME)?.value)?.uid ?? null;
  if (!uid) {
    return Response.json({ error: "Sign in required" }, { status: 401 });
  }
  const { slug: sourceSlug } = await params;
  if (!canView(sourceSlug, uid)) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  const source = getProject(sourceSlug, uid);
  if (!source) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  const body = await request.json().catch(() => ({}));
  const angle = String(body.angle ?? "").trim();
  const name = String(body.name ?? "").trim();
  const sourceDebtId =
    body.source_debt_id == null ? null : String(body.source_debt_id).trim();
  const sourceClaimIds = Array.isArray(body.source_claim_ids)
    ? body.source_claim_ids.map((x: any) => String(x)).filter(Boolean).slice(0, 20)
    : [];
  const sourceUrl =
    body.source_url == null ? null : String(body.source_url).trim();
  const resolutionAxis =
    body.resolution_axis == null ? null : String(body.resolution_axis).trim();
  if (angle.length < 8) {
    return Response.json(
      {
        error:
          "Describe the additional angle (≥8 chars) — e.g. 'focus on safety', 'add a comparison with X', 'reframe for marketing'",
      },
      { status: 400 }
    );
  }

  const tail = uid.replace(/^u_/, "").slice(0, 6);
  const nameSegment = name ? slugifyName(name, "ext") : "ext";
  let newSlug = `${sourceSlug.slice(0, 55)}-${nameSegment}-${tail}`.slice(0, 90);
  if (existsSync(join(projectsDir(), newSlug))) {
    newSlug = `${newSlug}-${Date.now().toString(36).slice(-4)}`;
  }

  const sourceDir = join(projectsDir(), sourceSlug);
  const newDir = join(projectsDir(), newSlug);

  try {
    mkdirSync(newDir, { recursive: true });
    // Copy the full artifact set so the redirected page renders
    // instantly with the source's report while the extend pipeline
    // regenerates plan/evidence/analysis/synth in place. Without this,
    // opening /projects/<newSlug> 404s for the first ~30 seconds until
    // planner writes plan.json.
    for (const name of [
      "plan.json",
      "facts.json",
      "verification.json",
      "scout_digest.json",
      "analysis_report.json",
      "REPORT.md",
    ]) {
      const src = join(sourceDir, name);
      if (existsSync(src)) cpSync(src, join(newDir, name));
    }
    if (existsSync(join(sourceDir, "sources"))) {
      cpSync(join(sourceDir, "sources"), join(newDir, "sources"), {
        recursive: true,
      });
    }
    writeFileSync(
      join(newDir, "fork.meta.json"),
      JSON.stringify(
        {
          source_slug: sourceSlug,
          source_topic: source.plan?.topic ?? "",
          angle,
          forked_at: Date.now(),
          forked_by: uid,
          suffix: name || null,
          kind: "extend",
          source_debt_id: sourceDebtId || null,
          source_claim_ids: sourceClaimIds,
          source_url: sourceUrl || null,
          resolution_axis: resolutionAxis || null,
        },
        null,
        2
      )
    );
    setOwner(newSlug, uid);
    if (sourceDebtId) {
      setDebtStatus(
        sourceSlug,
        sourceDebtId,
        {
          status: "running",
          branch_slug: newSlug,
          note: "Follow-up branch started for this research debt item.",
        },
        uid
      );
    }
  } catch (err: any) {
    return Response.json(
      { error: `Extend copy failed: ${err?.message ?? String(err)}` },
      { status: 500 }
    );
  }

  // Combined topic for the pipeline. The planner system prompt picks up
  // both the original framing and the extension when regenerating.
  const extendedTopic = `${source.plan?.topic ?? sourceSlug}\n\nADDITIONAL ANGLE (user extension): ${angle}`;
  const constraintStr = source.plan?.constraints
    ? String(source.plan.constraints)
    : undefined;

  const result = startRun(extendedTopic, constraintStr, uid, {
    forceSlug: newSlug,
    extraArgs: [
      "--replan",
      "--re-evidence",
      "--re-verify",
      "--re-analyze",
    ],
  });

  return Response.json({
    ok: true,
    slug: newSlug,
    runId: result.runId,
    source_slug: sourceSlug,
  });
}
