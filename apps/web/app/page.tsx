import Link from "next/link";
import { listProjects } from "@/lib/projects";
import { NewResearchForm } from "@/components/new-research";
import { LivePipeline } from "@/components/live-pipeline";
import { LandingHero } from "@/components/landing-hero";
import { ResearchTable } from "@/components/research-table";
import { cookies } from "next/headers";
import { verifySession, COOKIE_NAME } from "@/lib/sessions";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const jar = await cookies();
  const viewerUid = verifySession(jar.get(COOKIE_NAME)?.value)?.uid ?? null;
  const projects = listProjects(viewerUid);
  const yours = viewerUid
    ? projects.filter((p) => p.owner_uid === viewerUid)
    : [];

  // ─── Anonymous visitor → marketing landing ────────────────────────
  if (!viewerUid) {
    return <LandingHero />;
  }

  // ─── Signed-in dashboard ──────────────────────────────────────────
  const totals = {
    projects: yours.length,
    questions: yours.reduce(
      (n, p) => n + Math.max(p.questions, p.hypotheses),
      0
    ),
    facts: yours.reduce((n, p) => n + Math.max(p.facts, p.claims), 0),
    sources: yours.reduce((n, p) => n + p.sources, 0),
  };

  return (
    <div className="max-w-[1320px] mx-auto px-4 md:px-10 py-6 md:py-8 pb-20 space-y-10 md:space-y-11">
      {/* Hero */}
      <section>
        <div className="micro text-accent-primary mb-3">Overview</div>
        <h1 className="rl-dash-title">
          Hypothesis-free research, <em>grounded in</em>{" "}
          <span className="acc">verified evidence.</span>
        </h1>
        <p className="text-[14px] md:text-[15px] leading-relaxed text-fg-dim max-w-[640px]">
          Enter a topic. The engine decomposes it into literature-driven
          questions, harvests primary sources across Arxiv, OpenAlex and
          SearXNG, cross-checks every claim against its cited URL, and
          synthesizes the findings into a single citable document.
        </p>
      </section>

      {/* Live pipeline */}
      <LivePipeline />

      {/* CTA + Metrics */}
      <section className="grid grid-cols-1 lg:grid-cols-[1.25fr_1fr] gap-5">
        <div className="rl-cta-card">
          <div className="flex items-baseline justify-between mb-3 relative">
            <h3 className="text-[14px] font-semibold tracking-tight m-0">
              Start a new investigation
            </h3>
            <span className="font-mono text-[10.5px] text-fg-muted">
              typically 30–80 min
            </span>
          </div>
          <NewResearchForm />
        </div>

        <div className="bg-ink-800 border border-ink-600 rounded-[14px] p-5 md:p-6 flex flex-col">
          <div className="flex items-baseline justify-between mb-4">
            <h3 className="text-[14px] font-semibold tracking-tight m-0">
              Library
            </h3>
            <span className="font-mono text-[10.5px] text-fg-muted">
              lifetime
            </span>
          </div>
          <div className="rl-metrics-grid">
            <Metric label="Projects" value={totals.projects} tone="accent" />
            <Metric label="Questions" value={totals.questions} tone="accent" />
            <Metric label="Facts verified" value={totals.facts} tone="sage" />
            <Metric label="Sources" value={totals.sources} tone="sage" />
          </div>
        </div>
      </section>

      {/* Research table */}
      <section>
        <div className="flex items-baseline justify-between mb-3 md:mb-4 gap-3">
          <h2 className="text-[16px] font-semibold tracking-tight">
            Your research
          </h2>
          <span className="text-[11px] text-fg-muted tnum shrink-0">
            {yours.length} {yours.length === 1 ? "report" : "reports"}
          </span>
        </div>

        <ResearchTable projects={yours} />
      </section>
    </div>
  );
}

function Metric({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "accent" | "sage";
}) {
  return (
    <div className="rl-metric">
      <div className="lbl">{label}</div>
      <div className="val">
        {value}
        <SparkLine tone={tone} />
      </div>
    </div>
  );
}

function SparkLine({ tone }: { tone: "accent" | "sage" }) {
  const color = tone === "sage" ? "#6ee7a0" : "#e8a584";
  const pts =
    tone === "sage"
      ? "0,22 15,19 30,17 45,13 60,10 75,8 90,6 100,3"
      : "0,20 15,18 30,16 45,13 60,14 75,9 90,7 100,5";
  return (
    <svg
      className="ml-auto h-[16px] w-[56px] opacity-80"
      viewBox="0 0 100 24"
      preserveAspectRatio="none"
    >
      <polyline fill="none" stroke={color} strokeWidth="1.2" points={pts} />
    </svg>
  );
}

function ProjectRow({
  project,
}: {
  project: {
    slug: string;
    topic: string;
    schema: string;
    questions: number;
    hypotheses: number;
    facts: number;
    claims: number;
    sources: number;
    hasReport: boolean;
    is_showcase: boolean;
  };
}) {
  const q = project.questions || project.hypotheses;
  const f = project.facts || project.claims;
  const status = project.hasReport
    ? "verified"
    : (project as any).status === "running"
      ? "running"
      : "pending";

  // Smart-split topic: question + subhead for long formulations
  const { title, subhead } = splitTopic(project.topic);

  return (
    <Link href={`/projects/${project.slug}`} className="rl-research-row">
      <div className="rl-r-title">
        <div className="rl-r-icon">
          {status === "verified" ? (
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M9 11l3 3L22 4" />
              <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
            </svg>
          ) : status === "running" ? (
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
          ) : (
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
            </svg>
          )}
        </div>
        <div className="rl-r-title-text">
          <div className="q">{title}</div>
          {subhead && <div className="sub">{subhead}</div>}
        </div>
      </div>
      <div className="rl-r-stats r-hide-mobile">
        <span className="s">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
            <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
          </svg>
          <strong>{project.sources}</strong>
        </span>
      </div>
      <div className="r-hide-mobile">
        <div className="rl-r-claims tnum">
          {f} <span className="of">claims</span>
        </div>
        {f > 0 && (
          <div className="rl-r-verify-bar">
            <span
              style={{
                width: "100%",
                background:
                  status === "running" ? "var(--accent-amber)" : undefined,
              }}
            />
          </div>
        )}
      </div>
      <div className="rl-r-date r-hide-mobile">
        {project.schema === "hypothesis" ? "hyp" : "q&a"}
      </div>
      <div>
        <span
          className={
            status === "running"
              ? "rl-r-status running"
              : status === "pending"
                ? "rl-r-status pending"
                : "rl-r-status"
          }
        >
          <span className="dot" />
          {status}
        </span>
      </div>
      <div className="rl-r-arrow">→</div>
    </Link>
  );
}

function splitTopic(topic: string): { title: string; subhead: string | null } {
  const t = topic.trim();
  // If there's a question mark, split at first one
  const qIdx = t.indexOf("?");
  if (qIdx > 0 && qIdx < t.length - 1) {
    return {
      title: t.slice(0, qIdx + 1),
      subhead: t.slice(qIdx + 1).trim() || null,
    };
  }
  // If topic is long (>90 chars), split at first sentence or comma cluster
  if (t.length > 90) {
    const dot = t.search(/[.:]\s/);
    if (dot > 20 && dot < 80) {
      return {
        title: t.slice(0, dot + 1),
        subhead: t.slice(dot + 1).trim(),
      };
    }
    // comma list — show first ~70 chars, rest as subhead
    return {
      title: t.slice(0, 70).trimEnd() + "…",
      subhead: t.slice(70).trim().slice(0, 120),
    };
  }
  return { title: t, subhead: null };
}
