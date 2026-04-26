// POST /api/projects/:slug/tweak — regenerate ONE section of a report
// with a user-supplied hint ("simplify", "don't mention brands", etc).
// Saves the variant as variants/<section>_<ts>.json so the UI can list
// snapshots and let the user switch between them.
//
// The canonical REPORT.md stays untouched; variants are additive.
// Ownership: caller must be owner or admin of the project.

import { getProject, canView, getOwner } from "@/lib/projects";
import { findUserById } from "@/lib/users";
import { cookies } from "next/headers";
import { verifySession, COOKIE_NAME } from "@/lib/sessions";
import {
  writeFileSync,
  readFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
} from "fs";
import { join } from "path";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

const TWEAKABLE = new Set([
  "introduction",
  "summary", // overall analysis summary
  "recommendation",
  "deployment",
  "comparison",
]);

function projectsDir(): string {
  if (process.env.PROJECTS_DIR) return process.env.PROJECTS_DIR;
  const cwdProjects = join(process.cwd(), "projects");
  if (existsSync(cwdProjects)) return cwdProjects;
  return join(process.cwd(), "..", "..", "projects");
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
  const { slug } = await params;
  if (!canView(slug, uid)) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  const user = findUserById(uid);
  const owner = getOwner(slug);
  const isOwner = owner && owner === uid;
  const isAdmin = user?.role === "admin";
  if (!isOwner && !isAdmin) {
    return Response.json(
      { error: "Only the project owner or an admin can tweak sections" },
      { status: 403 }
    );
  }

  const body = await request.json().catch(() => ({}));
  const section = String(body.section ?? "").trim().toLowerCase();
  const hint = String(body.hint ?? "").trim();
  if (!TWEAKABLE.has(section)) {
    return Response.json(
      {
        error: `Unknown section "${section}". Tweakable: ${[...TWEAKABLE].join(", ")}`,
      },
      { status: 400 }
    );
  }
  if (!hint || hint.length < 4) {
    return Response.json(
      { error: "Provide a hint (≥4 chars) describing the change you want" },
      { status: 400 }
    );
  }

  const project = getProject(slug, uid);
  if (!project) {
    return Response.json({ error: "Project not found" }, { status: 404 });
  }

  // Load top facts block the same way synthesizer does — top N verified
  // by confidence, condensed.
  const facts = project.facts ?? [];
  const verMap = new Map<string, string>();
  for (const v of project.verification?.verifications ?? []) {
    verMap.set(v.claim_id ?? v.fact_id, v.verdict);
  }
  const verified = facts.filter(
    (f: any) => !verMap.has(f.id) || verMap.get(f.id) === "verified"
  );
  const topFactsForPrompt = verified
    .slice()
    .sort((a: any, b: any) => (b.confidence ?? 0) - (a.confidence ?? 0))
    .slice(0, 60)
    .map((f: any) => {
      const ref = f.references?.[0];
      const refStr = ref ? ` [${ref.title?.slice(0, 60) ?? ref.url}]` : "";
      return `[${f.id}] (${f.factuality}, conf ${((f.confidence ?? 0) * 100).toFixed(0)}%) ${f.statement}${refStr}`;
    })
    .join("\n");

  let generated: string;
  try {
    const regen = await import("@/lib/section-regen");
    const analysis = project.analysisReport;
    const plan = project.plan;
    switch (section) {
      case "introduction":
        generated = await regen.tweakIntroduction(plan, hint);
        break;
      case "comparison":
        generated = await regen.tweakComparisonTable(plan, topFactsForPrompt, hint);
        break;
      case "deployment":
        generated = await regen.tweakDeployment(plan, topFactsForPrompt, analysis, hint);
        break;
      case "recommendation":
        generated = await regen.tweakRecommendation(plan, analysis, hint);
        break;
      case "summary":
        generated = await regen.tweakSummary(plan, analysis, hint);
        break;
      default:
        return Response.json({ error: "Unreachable" }, { status: 500 });
    }
  } catch (err: any) {
    return Response.json(
      { error: `Tweak generation failed: ${err?.message ?? String(err)}` },
      { status: 502 }
    );
  }

  if (!generated || !generated.trim()) {
    return Response.json(
      { error: "Generator returned empty — try a different hint" },
      { status: 502 }
    );
  }

  // Persist to projects/<slug>/variants/<section>_<ts>.json
  const variantsDir = join(projectsDir(), slug, "variants");
  mkdirSync(variantsDir, { recursive: true });
  const ts = Date.now();
  const id = `${section}_${ts}`;
  const variant = {
    id,
    section,
    hint,
    content: generated,
    created_at: ts,
    created_by: uid,
  };
  writeFileSync(
    join(variantsDir, `${id}.json`),
    JSON.stringify(variant, null, 2)
  );

  return Response.json({ ok: true, variant });
}

// GET — list all variants for this project
export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const jar = await cookies();
  const uid = verifySession(jar.get(COOKIE_NAME)?.value)?.uid ?? null;
  const { slug } = await params;
  if (!canView(slug, uid)) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  const variantsDir = join(projectsDir(), slug, "variants");
  if (!existsSync(variantsDir)) {
    return Response.json({ variants: [] });
  }
  const variants: any[] = [];
  for (const f of readdirSync(variantsDir)) {
    if (!f.endsWith(".json")) continue;
    try {
      variants.push(JSON.parse(readFileSync(join(variantsDir, f), "utf-8")));
    } catch {}
  }
  variants.sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0));
  return Response.json({ variants });
}
