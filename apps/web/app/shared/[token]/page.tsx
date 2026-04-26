// Public read-only view of a shared project. No auth required — the
// share token itself is the capability. Rendered without the AppShell
// sidebar so external collaborators don't see the rest of the app.

import { notFound } from "next/navigation";
import Link from "next/link";
import { resolveShareToken } from "@/lib/share-tokens";
import { getProject } from "@/lib/projects";
import { ProjectDocument } from "@/components/project-document";
import { TopicHeader } from "@/components/topic-header";

export const dynamic = "force-dynamic";
export const metadata = { robots: { index: false, follow: false } };

function StatusPill({ status }: { status: "verified" | "pending" | "running" }) {
  const styles: Record<string, string> = {
    verified: "bg-accent-sage/10 text-accent-sage",
    pending: "bg-accent-amber/10 text-accent-amber",
    running: "bg-accent-rust/15 text-accent-rust",
  };
  const dotCls: Record<string, string> = {
    verified: "bg-accent-sage",
    pending: "bg-accent-amber",
    running: "bg-accent-rust animate-pulse",
  };
  return (
    <span
      className={`inline-flex items-center gap-1.5 pl-2 pr-2.5 py-0.5 rounded-full text-[11px] font-medium ${styles[status]}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${dotCls[status]}`} />
      {status}
    </span>
  );
}

export default async function SharedProjectPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const share = resolveShareToken(token);
  if (!share) notFound();
  // resolveShareToken returns the slug → fetch the project bypassing
  // session visibility. We pass a sentinel "shared" uid that isn't
  // matched by any getProject check, so the project returns null UNLESS
  // we special-case it. Simpler: read it as if we are the owner.
  const project = getProject(share.slug, share.created_by);
  if (!project) notFound();

  const { plan, analysisReport, report, facts, sources, verification } = project;
  const questions = (plan.questions as any[]) ?? [];
  const totalSources = sources?.total_sources ?? 0;
  const verifiedFacts = verification?.summary?.verified ?? 0;
  const totalFacts = verification?.summary?.total ?? facts.length;
  const statusLabel = report
    ? "verified"
    : analysisReport
      ? "pending"
      : "running";

  return (
    <div className="min-h-screen bg-ink-900 text-fg">
      <header className="border-b border-ink-600 px-4 md:px-10 py-3 flex items-center gap-3">
        <Link href="/" className="flex items-center gap-2.5">
          <div className="h-7 w-7 rounded-md bg-gradient-to-br from-accent-primary to-accent-rust grid place-items-center">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path
                d="M3 3h8M3 7h5M3 11h8"
                stroke="white"
                strokeWidth="1.6"
                strokeLinecap="round"
              />
            </svg>
          </div>
          <span className="text-[13px] font-semibold">Syncera</span>
        </Link>
        <span className="text-fg-faint">/</span>
        <span className="text-[12px] text-fg-muted">shared report</span>
        <div className="ml-auto">
          <Link
            href="/signup"
            className="text-[12px] px-3 py-1.5 rounded-md bg-accent-primary text-ink-900 font-medium hover:brightness-110"
          >
            Create your own
          </Link>
        </div>
      </header>

      <div className="max-w-[1320px] mx-auto px-4 md:px-10 py-6 md:py-10">
        <article className="min-w-0">
          <header className="mb-8 md:mb-10">
            <div className="flex items-center gap-2 mb-4 flex-wrap">
              <StatusPill status={statusLabel as "verified" | "pending" | "running"} />
              <span className="micro text-fg-muted font-mono">
                {share.slug.slice(0, 10).toUpperCase()}
              </span>
              <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-accent-sage/10 text-accent-sage text-[11px] font-medium">
                shared link · read-only
              </span>
            </div>

            <TopicHeader topic={plan.topic} />

            <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 text-[12px] text-fg-muted">
              <div className="flex items-center gap-4 tnum">
                <span>
                  <span className="text-fg-faint">Q</span>{" "}
                  <span className="text-fg-dim">{questions.length}</span>
                </span>
                <span>
                  <span className="text-fg-faint">F</span>{" "}
                  <span className="text-fg-dim">{facts.length}</span>
                </span>
                <span>
                  <span className="text-fg-faint">S</span>{" "}
                  <span className="text-fg-dim">{totalSources}</span>
                </span>
                {totalFacts > 0 && (
                  <span>
                    <span className="text-fg-faint">verified</span>{" "}
                    <span className="text-accent-sage">
                      {verifiedFacts}/{totalFacts}
                    </span>
                  </span>
                )}
              </div>
            </div>
          </header>

          <ProjectDocument project={project} />
        </article>
      </div>
    </div>
  );
}
