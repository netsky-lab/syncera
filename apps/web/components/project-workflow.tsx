"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ComponentType } from "react";
import { useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  Brain,
  Check,
  Copy,
  Download,
  ExternalLink,
  FileText,
  GitBranch,
  Library,
  ListChecks,
  Network,
  Quote,
  Search,
  Share2,
  ShieldCheck,
  Sparkles,
  X,
} from "lucide-react";
import type { ProjectDetail, ProjectSummary } from "@/lib/projects";
import { ComparePicker } from "@/components/compare-picker";
import { ForkButton } from "@/components/fork-button";
import { ProjectAdminActions } from "@/components/project-admin-actions";
import { ProjectDocument } from "@/components/project-document";
import { ProjectRerunButton } from "@/components/project-rerun-button";
import { ProjectRunBanner } from "@/components/project-run-banner";
import { ShareButton } from "@/components/share-button";
import { TopicHeader } from "@/components/topic-header";

type Branches = {
  children: ProjectSummary[];
  parent: ProjectSummary | null;
  siblings: ProjectSummary[];
};

type TabId =
  | "brief"
  | "claims"
  | "cognition"
  | "sources"
  | "coverage"
  | "versions"
  | "report";

type SourceRow = {
  key: string;
  title: string;
  url: string;
  provider: string;
  questionId: string;
  subquestionId: string;
  usefulness: number | null;
  domainMatch: string | null;
  type: string | null;
};

const tabs: { id: TabId; label: string; icon: ComponentType<{ size?: number }> }[] = [
  { id: "report", label: "Report", icon: FileText },
  { id: "claims", label: "Claims", icon: Network },
  { id: "cognition", label: "Cognition", icon: Brain },
  { id: "brief", label: "Brief", icon: ListChecks },
  { id: "sources", label: "Sources", icon: Library },
  { id: "coverage", label: "Coverage", icon: Activity },
  { id: "versions", label: "Versions", icon: GitBranch },
];

function truncateTopic(s: string, n: number): string {
  if (s.length <= n) return s;
  return `${s.slice(0, n).trimEnd()}...`;
}

function coverageTone(coverage: string): string {
  switch (coverage) {
    case "complete":
      return "bg-accent-sage/10 text-accent-sage border-accent-sage/20";
    case "partial":
      return "bg-accent-amber/10 text-accent-amber border-accent-amber/20";
    case "gaps_critical":
      return "bg-accent-rust/10 text-accent-rust border-accent-rust/20";
    case "insufficient":
      return "bg-accent-red/10 text-accent-red border-accent-red/20";
    default:
      return "bg-ink-700 text-fg-muted border-ink-600";
  }
}

function lifecycleTone(state: string): string {
  switch (state) {
    case "verified":
      return "bg-accent-sage/10 text-accent-sage border-accent-sage/20";
    case "contested":
      return "bg-accent-amber/10 text-accent-amber border-accent-amber/20";
    case "blocked":
      return "bg-accent-red/10 text-accent-red border-accent-red/20";
    default:
      return "bg-ink-700 text-fg-muted border-ink-600";
  }
}

function formatCompact(n: number): string {
  if (!Number.isFinite(n)) return "0";
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(Math.round(n));
}

function hostOf(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function copyText(text: string) {
  navigator.clipboard?.writeText(text).catch(() => {});
}

function StatusPill({
  status,
}: {
  status: "verified" | "pending" | "running";
}) {
  const cls =
    status === "verified"
      ? "bg-accent-sage/10 text-accent-sage"
      : status === "pending"
        ? "bg-accent-amber/10 text-accent-amber"
        : "bg-accent-rust/15 text-accent-rust";
  const dot =
    status === "verified"
      ? "bg-accent-sage"
      : status === "pending"
        ? "bg-accent-amber"
        : "bg-accent-rust animate-pulse";
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium ${cls}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
      {status}
    </span>
  );
}

function StatCard({
  label,
  value,
  meta,
}: {
  label: string;
  value: string | number;
  meta?: string;
}) {
  return (
    <div className="min-w-0 rounded-lg border border-fg/[0.06] bg-ink-800 p-4 card-warm">
      <div className="micro text-fg-muted">{label}</div>
      <div className="mt-3 flex items-end justify-between gap-3">
        <div className="tnum text-2xl font-semibold leading-none text-fg">
          {value}
        </div>
        {meta && (
          <div className="truncate text-right text-[11px] text-fg-muted">
            {meta}
          </div>
        )}
      </div>
    </div>
  );
}

function flattenSources(project: ProjectDetail): SourceRow[] {
  const rows: SourceRow[] = [];
  for (const unit of project.units ?? []) {
    for (const result of unit.results ?? []) {
      const url = String(result.url ?? "");
      if (!url) continue;
      rows.push({
        key: `${unit.question_id ?? "q"}-${unit.subquestion_id ?? "sq"}-${url}`,
        title: String(result.title ?? url),
        url,
        provider: String(result.provider ?? "source"),
        questionId: String(unit.question_id ?? ""),
        subquestionId: String(unit.subquestion_id ?? ""),
        usefulness:
          typeof result.relevance?.usefulness === "number"
            ? result.relevance.usefulness
            : null,
        domainMatch: result.relevance?.domain_match ?? null,
        type: result.relevance?.source_type ?? null,
      });
    }
  }
  return rows;
}

function phaseRows(project: ProjectDetail) {
  return [
    ["Brief", Boolean(project.plan?.questions?.length)],
    ["Harvest", Boolean(project.sources?.total_sources)],
    ["Evidence", (project.facts ?? []).length > 0],
    ["Verify", Boolean(project.verification?.summary)],
    ["Analyze", Boolean(project.analysisReport?.answers?.length)],
    ["Contradictions", Boolean(project.epistemicGraph?.contradiction_pass)],
    ["Synthesis", Boolean(project.report)],
  ] as const;
}

function BranchRow({ project }: { project: ProjectSummary }) {
  return (
    <Link
      href={`/projects/${project.slug}`}
      className="block rounded-md border border-fg/[0.06] bg-ink-900 px-3 py-2 transition hover:border-accent-primary/30 hover:bg-ink-800"
    >
      <div className="line-clamp-1 text-[13px] text-fg-dim">
        {project.topic}
      </div>
      <div className="mt-1 flex items-center gap-3 font-mono text-[10.5px] text-fg-muted">
        <span>{project.slug.slice(0, 16)}</span>
        <span>{project.facts} facts</span>
        <span>{project.sources} sources</span>
      </div>
    </Link>
  );
}

export function ProjectWorkflow({
  project,
  slug,
  viewerUid,
  isViewerAdmin,
  branches,
}: {
  project: ProjectDetail;
  slug: string;
  viewerUid: string | null;
  isViewerAdmin: boolean;
  branches: Branches;
}) {
  const [activeTab, setActiveTab] = useState<TabId>("report");
  const [sourceQuery, setSourceQuery] = useState("");
  const [providerFilter, setProviderFilter] = useState("all");
  const [sourceQuality, setSourceQuality] = useState<"all" | "useful">("all");
  const [claimQuery, setClaimQuery] = useState("");
  const [claimStateFilter, setClaimStateFilter] = useState("all");
  const [selectedClaimId, setSelectedClaimId] = useState<string | null>(null);
  const [followUpBusy, setFollowUpBusy] = useState<string | null>(null);
  const router = useRouter();
  const { plan, facts, analysisReport, report, sources, verification } = project;
  const questions = (plan.questions ?? []) as any[];
  const constraints = Array.isArray(plan.constraints) ? plan.constraints : [];
  const scopeNotes = Array.isArray(plan.scope_notes) ? plan.scope_notes : [];
  const answers = (analysisReport?.answers ?? []) as any[];
  const sourceRows = useMemo(() => flattenSources(project), [project]);
  const verifiedFacts = verification?.summary?.verified ?? 0;
  const totalFacts = verification?.summary?.total ?? facts.length;
  const verifiedPct =
    totalFacts > 0 ? Math.round((verifiedFacts / totalFacts) * 100) : 0;
  const weakAnswers = answers.filter(
    (a) => a.coverage === "insufficient" || a.coverage === "gaps_critical"
  );
  const coveragePct =
    answers.length > 0
      ? Math.round(
          (answers.reduce((sum, a) => {
            if (a.coverage === "complete") return sum + 1;
            if (a.coverage === "partial") return sum + 0.65;
            if (a.coverage === "gaps_critical") return sum + 0.3;
            return sum;
          }, 0) /
            answers.length) *
            100
        )
      : 0;
  const statusLabel: "verified" | "pending" | "running" = report
    ? "verified"
    : analysisReport
      ? "pending"
      : "running";
  const canEdit =
    isViewerAdmin || (project.owner_uid != null && project.owner_uid === viewerUid);
  const totalSources = sources?.total_sources ?? 0;
  const totalLearnings = sources?.total_learnings ?? 0;
  const byProvider = (sources?.by_provider ?? {}) as Record<string, number>;
  const branchCount =
    branches.children.length + branches.siblings.length + (branches.parent ? 1 : 0);
  const usage = project.usageSummary;
  const usageTotals = usage?.totals ?? null;
  const costUsd =
    typeof usageTotals?.estimated_cost_usd === "number"
      ? usageTotals.estimated_cost_usd
      : null;
  const totalTokens =
    typeof usageTotals?.total_tokens === "number" ? usageTotals.total_tokens : null;
  const llmCalls =
    typeof usageTotals?.calls === "number" ? usageTotals.calls : null;
  const phaseUsage = Object.entries((usage?.by_phase ?? {}) as Record<string, any>)
    .map(([phase, bucket]) => ({
      phase,
      calls: Number(bucket?.calls ?? 0),
      tokens: Number(bucket?.total_tokens ?? 0),
      cost: Number(bucket?.estimated_cost_usd ?? 0),
    }))
    .filter((x) => x.calls > 0 || x.tokens > 0)
    .sort((a, b) => b.cost - a.cost || b.tokens - a.tokens);
  const providerOptions = Object.keys(byProvider).sort();
  const visibleSources = sourceRows.filter((source) => {
    const q = sourceQuery.trim().toLowerCase();
    const matchesQuery =
      !q ||
      source.title.toLowerCase().includes(q) ||
      source.url.toLowerCase().includes(q) ||
      source.questionId.toLowerCase().includes(q) ||
      source.subquestionId.toLowerCase().includes(q);
    const matchesProvider =
      providerFilter === "all" || source.provider === providerFilter;
    const matchesQuality =
      sourceQuality === "all" || (source.usefulness ?? 0) >= 2;
    return matchesQuery && matchesProvider && matchesQuality;
  });
  const verMap = new Map(
    (verification?.verifications ?? []).map((v: any) => [
      v.fact_id ?? v.claim_id,
      v,
    ])
  );
  const verifiedByQuestion = new Map<string, number>();
  const factsByQuestion = new Map<string, number>();
  const sourceRowsByQuestion = new Map<string, number>();
  for (const fact of facts ?? []) {
    const qid = String(fact.question_id ?? "");
    factsByQuestion.set(qid, (factsByQuestion.get(qid) ?? 0) + 1);
    const v = verMap.get(fact.id);
    if (!v || (v as any).verdict === "verified") {
      verifiedByQuestion.set(qid, (verifiedByQuestion.get(qid) ?? 0) + 1);
    }
  }
  for (const source of sourceRows) {
    if (!source.questionId) continue;
    sourceRowsByQuestion.set(
      source.questionId,
      (sourceRowsByQuestion.get(source.questionId) ?? 0) + 1
    );
  }
  const rejectedFacts = Math.max(0, totalFacts - verifiedFacts);
  const answerCoverage = new Map(answers.map((a) => [a.question_id, a.coverage]));
  const openFollowUps = answers.flatMap((a) =>
    (a.follow_ups ?? []).map((f: string) => ({
      questionId: a.question_id,
      text: f,
    }))
  );
  const answerByQuestion = new Map(answers.map((a) => [a.question_id, a]));
  const derivedClaimLifecycle = (facts ?? [])
    .map((fact: any) => {
      const verdict = String((verMap.get(fact.id) as any)?.verdict ?? "unverified");
      const answer = answerByQuestion.get(fact.question_id) as any;
      const conflicts = (answer?.conflicting_facts ?? []).filter(
        (c: any) => c.fact_a === fact.id || c.fact_b === fact.id
      );
      const state =
        verdict === "verified"
          ? conflicts.length
            ? "contested"
            : "verified"
          : verdict === "unverified"
            ? "unverified"
            : "blocked";
      return {
        id: String(fact.id ?? ""),
        statement: String(fact.statement ?? ""),
        questionId: String(fact.question_id ?? ""),
        subquestionId: String(fact.subquestion_id ?? ""),
        confidence:
          typeof fact.confidence === "number" ? Math.round(fact.confidence * 100) : null,
        evidenceCount: Array.isArray(fact.references) ? fact.references.length : 0,
        sourceHost: fact.references?.[0]?.url ? hostOf(fact.references[0].url) : "",
        state,
        verdict,
        keyFact: (answer?.key_facts ?? []).includes(fact.id),
        openQuestions: [...(answer?.gaps ?? []), ...(answer?.follow_ups ?? [])],
      };
    })
    .sort((a, b) => {
      const priority = (x: string) =>
        x === "contested" ? 0 : x === "blocked" ? 1 : x === "verified" ? 2 : 3;
      return priority(a.state) - priority(b.state) || (b.confidence ?? 0) - (a.confidence ?? 0);
    });
  const graphClaimLifecycle = ((project.epistemicGraph?.claims ?? []) as any[]).map(
    (claim: any) => ({
      id: String(claim.id ?? ""),
      statement: String(claim.statement ?? ""),
      questionId: String(claim.question_id ?? ""),
      subquestionId: String(claim.subquestion_id ?? ""),
      confidence:
        typeof claim.confidence === "number"
          ? Math.round(claim.confidence * 100)
          : null,
      evidenceCount: Array.isArray(claim.evidence) ? claim.evidence.length : 0,
      sourceHost: claim.evidence?.[0]?.url ? hostOf(claim.evidence[0].url) : "",
      state: String(claim.lifecycle_state ?? "unverified"),
      verdict: String(claim.verdict ?? "unverified"),
      keyFact: Boolean(claim.dependencies?.is_key_fact),
      openQuestions: claim.dependencies?.open_questions ?? [],
    })
  );
  const claimLifecycle = graphClaimLifecycle.length
    ? graphClaimLifecycle
    : derivedClaimLifecycle;
  const derivedResearchDebt = answers.flatMap((answer: any) => [
    ...(answer.gaps ?? []).map((gap: string) => ({
      questionId: String(answer.question_id ?? ""),
      kind: "Unknown",
      severity:
        answer.coverage === "insufficient" || answer.coverage === "gaps_critical"
          ? "high"
          : "medium",
      text: gap,
    })),
    ...(answer.follow_ups ?? []).map((followUp: string) => ({
      questionId: String(answer.question_id ?? ""),
      kind: "Next check",
      severity: answer.coverage === "complete" ? "low" : "medium",
      text: followUp,
    })),
  ]);
  const graphResearchDebt = ((project.epistemicGraph?.research_debt ?? []) as any[]).map(
    (debt: any) => ({
      questionId: String(debt.question_id ?? ""),
      kind:
        debt.kind === "next_check"
          ? "Next check"
          : debt.kind === "weak_evidence"
            ? "Weak evidence"
            : "Unknown",
      severity: String(debt.severity ?? "medium"),
      text: String(debt.item ?? ""),
    })
  );
  const researchDebt = graphResearchDebt.length
    ? graphResearchDebt
    : derivedResearchDebt;
  const derivedContradictionMap = [
    ...answers.flatMap((answer: any) =>
      (answer.conflicting_facts ?? []).map((conflict: any) => ({
      scope: "Within question",
      verdict: "contradiction",
      label: String(answer.question_id ?? ""),
      facts: [conflict.fact_a, conflict.fact_b].filter(Boolean).join(" vs "),
      difference: String(conflict.nature ?? ""),
      resolutionAxes: ["benchmark", "workload"],
      nextCheck: null as string | null,
      confidence: null as number | null,
    }))
    ),
    ...(analysisReport?.cross_question_tensions ?? []).map((t: any) => ({
      scope: "Cross-question",
      verdict: "contradiction",
      label: (t.involved_questions ?? []).join(", "),
      facts: (t.involved_facts ?? []).join(", "),
      difference: String(t.description ?? ""),
      resolutionAxes: ["scope"],
      nextCheck: null as string | null,
      confidence: null as number | null,
    })),
  ];
  const graphContradictionMap = ((project.epistemicGraph?.contradictions ?? []) as any[]).map(
    (item: any) => ({
      scope:
        item.scope === "cross_question" ? "Cross-question" : "Within question",
      verdict: item.verdict ? String(item.verdict) : "contradiction",
      label: item.question_id
        ? String(item.question_id)
        : (item.involved_questions ?? []).join(", "),
      facts: (item.involved_facts ?? []).join(", "),
      difference: String(item.difference ?? ""),
      resolutionAxes: (item.resolution_axes ?? []) as string[],
      nextCheck: item.next_check ? String(item.next_check) : null,
      confidence:
        typeof item.confidence === "number"
          ? Math.round(item.confidence * 100)
          : null,
    })
  );
  const contradictionMap = graphContradictionMap.length
    ? graphContradictionMap
    : derivedContradictionMap;
  const graphClaimDetails = ((project.epistemicGraph?.claims ?? []) as any[]).map(
    (claim: any) => ({
      id: String(claim.id ?? ""),
      statement: String(claim.statement ?? ""),
      questionId: String(claim.question_id ?? ""),
      subquestionId: String(claim.subquestion_id ?? ""),
      state: String(claim.lifecycle_state ?? "unverified"),
      verdict: String(claim.verdict ?? "unverified"),
      confidence:
        typeof claim.confidence === "number"
          ? Math.round(claim.confidence * 100)
          : null,
      factuality: claim.factuality ? String(claim.factuality) : null,
      evidence: ((claim.evidence ?? []) as any[]).map((e: any) => ({
        url: String(e.url ?? ""),
        title: String(e.title ?? e.url ?? ""),
        exactQuote: String(e.exact_quote ?? ""),
        provider: e.provider ? String(e.provider) : null,
        sourceType: e.source_type ? String(e.source_type) : null,
        usefulness:
          typeof e.usefulness === "number" ? e.usefulness : null,
        domainMatch: e.domain_match ? String(e.domain_match) : null,
      })),
      counterevidence: ((claim.counterevidence ?? []) as any[]).map((c: any) => ({
        kind: String(c.kind ?? "counterevidence"),
        factId: c.fact_id ? String(c.fact_id) : null,
        verdict: c.verdict ? String(c.verdict) : null,
        severity: c.severity ? String(c.severity) : null,
        notes: String(c.notes ?? ""),
        correctedStatement: c.corrected_statement
          ? String(c.corrected_statement)
          : null,
      })),
      freshness: claim.freshness ?? null,
      dependencies: {
        questionCoverage: String(claim.dependencies?.question_coverage ?? "pending"),
        isKeyFact: Boolean(claim.dependencies?.is_key_fact),
        conflictingFacts: (claim.dependencies?.conflicting_facts ?? []) as string[],
        sourceHosts: (claim.dependencies?.source_hosts ?? []) as string[],
        openQuestions: (claim.dependencies?.open_questions ?? []) as string[],
      },
    })
  );
  const fallbackClaimDetails = (facts ?? []).map((fact: any) => {
    const verificationRow = verMap.get(fact.id) as any;
    const verdict = String(verificationRow?.verdict ?? "unverified");
    const answer = answerByQuestion.get(fact.question_id) as any;
    const conflicts = (answer?.conflicting_facts ?? []).filter(
      (c: any) => c.fact_a === fact.id || c.fact_b === fact.id
    );
    const state =
      verdict === "verified"
        ? conflicts.length
          ? "contested"
          : "verified"
        : verdict === "unverified"
          ? "unverified"
          : "blocked";
    return {
      id: String(fact.id ?? ""),
      statement: String(fact.statement ?? ""),
      questionId: String(fact.question_id ?? ""),
      subquestionId: String(fact.subquestion_id ?? ""),
      state,
      verdict,
      confidence:
        typeof fact.confidence === "number"
          ? Math.round(fact.confidence * 100)
          : null,
      factuality: fact.factuality ? String(fact.factuality) : null,
      evidence: ((fact.references ?? []) as any[]).map((ref: any) => ({
        url: String(ref.url ?? ""),
        title: String(ref.title ?? ref.url ?? ""),
        exactQuote: String(ref.exact_quote ?? ""),
        provider: null,
        sourceType: null,
        usefulness: null,
        domainMatch: null,
      })),
      counterevidence:
        verificationRow && verificationRow.verdict !== "verified"
          ? [
              {
                kind: "verification_rejection",
                factId: null,
                verdict,
                severity: verificationRow.severity ?? null,
                notes: String(verificationRow.notes ?? ""),
                correctedStatement: verificationRow.corrected_statement ?? null,
              },
            ]
          : conflicts.map((c: any) => ({
              kind: "conflicting_fact",
              factId: c.fact_a === fact.id ? c.fact_b : c.fact_a,
              verdict: null,
              severity: null,
              notes: String(c.nature ?? ""),
              correctedStatement: null,
            })),
      freshness: null,
      dependencies: {
        questionCoverage: String(answer?.coverage ?? "pending"),
        isKeyFact: (answer?.key_facts ?? []).includes(fact.id),
        conflictingFacts: conflicts.map((c: any) =>
          c.fact_a === fact.id ? c.fact_b : c.fact_a
        ),
        sourceHosts: ((fact.references ?? []) as any[]).map((ref: any) =>
          ref.url ? hostOf(String(ref.url)) : ""
        ),
        openQuestions: [...(answer?.gaps ?? []), ...(answer?.follow_ups ?? [])],
      },
    };
  });
  const claimDetails = (graphClaimDetails.length
    ? graphClaimDetails
    : fallbackClaimDetails
  ).sort((a, b) => {
    const priority = (state: string) =>
      state === "contested" ? 0 : state === "blocked" ? 1 : state === "unverified" ? 2 : 3;
    return priority(a.state) - priority(b.state) || (b.confidence ?? 0) - (a.confidence ?? 0);
  });
  const visibleClaims = claimDetails.filter((claim) => {
    const q = claimQuery.trim().toLowerCase();
    const matchesQuery =
      !q ||
      claim.id.toLowerCase().includes(q) ||
      claim.statement.toLowerCase().includes(q) ||
      claim.questionId.toLowerCase().includes(q) ||
      claim.subquestionId.toLowerCase().includes(q) ||
      claim.verdict.toLowerCase().includes(q);
    const matchesState =
      claimStateFilter === "all" || claim.state === claimStateFilter;
    return matchesQuery && matchesState;
  });
  const selectedClaim =
    visibleClaims.find((claim) => claim.id === selectedClaimId) ??
    visibleClaims[0] ??
    claimDetails[0] ??
    null;

  async function runFollowUp(angle: string, name = "resolve-contradiction") {
    if (!angle.trim()) return;
    setFollowUpBusy(angle);
    try {
      const r = await fetch(`/api/projects/${slug}/extend`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ angle, name }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        alert(`Follow-up failed: ${data.error ?? r.status}`);
        setFollowUpBusy(null);
        return;
      }
      router.push(`/projects/${data.slug}`);
    } catch (err: any) {
      alert(`Follow-up failed: ${err?.message ?? err}`);
      setFollowUpBusy(null);
    }
  }

  return (
    <div className="min-h-screen overflow-x-hidden">
      <header className="hidden h-12 min-w-0 items-center gap-3 border-b border-fg/[0.06] px-8 text-[12px] text-fg-muted md:flex">
        <Link href="/" className="shrink-0 transition-colors hover:text-fg-dim">
          Syncera
        </Link>
        <span className="shrink-0 opacity-40">/</span>
        <Link href="/" className="shrink-0 transition-colors hover:text-fg-dim">
          {project.is_showcase && project.owner_uid !== viewerUid
            ? "Showcase"
            : "Projects"}
        </Link>
        <span className="shrink-0 opacity-40">/</span>
        <span className="min-w-0 flex-1 truncate text-fg-dim" title={plan.topic}>
          {truncateTopic(plan.topic, 90)}
        </span>
      </header>

      <main className="mx-auto w-full max-w-[1480px] px-3 py-4 sm:px-5 md:px-8 md:py-8">
        <ProjectRunBanner slug={slug} />

        <div className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1fr)_330px]">
          <section className="min-w-0 space-y-5">
            <header className="rounded-lg border border-fg/[0.06] bg-ink-800 p-4 sm:p-5 card-warm">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <StatusPill status={statusLabel} />
                <span className="font-mono text-[11px] text-fg-muted">
                  {slug.slice(0, 10).toUpperCase()}
                </span>
                {project.is_showcase && project.owner_uid !== viewerUid && (
                  <span className="rounded-full bg-accent-primary/10 px-2 py-0.5 text-[11px] font-medium text-accent-primary">
                    showcase
                  </span>
                )}
                {project.forkMeta && (
                  <Link
                    href={`/projects/${project.forkMeta.source_slug}`}
                    className="rounded-full bg-accent-sage/10 px-2 py-0.5 text-[11px] font-medium text-accent-sage hover:bg-accent-sage/20"
                  >
                    forked
                  </Link>
                )}
              </div>

              <div className="mt-4 min-w-0">
                <TopicHeader topic={plan.topic} />
              </div>

              <div className="mt-5 grid w-full grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
                <StatCard
                  label="Coverage"
                  value={`${coveragePct}%`}
                  meta={`${answers.length}/${questions.length || answers.length || 0} answered`}
                />
                <StatCard
                  label="Verified"
                  value={`${verifiedPct}%`}
                  meta={`${verifiedFacts}/${totalFacts || 0} facts`}
                />
                <StatCard
                  label="Sources"
                  value={totalSources}
                  meta={`${totalLearnings} learnings`}
                />
                <StatCard
                  label="Open gaps"
                  value={weakAnswers.length}
                  meta={branchCount ? `${branchCount} branches` : "current run"}
                />
                <StatCard
                  label="LLM cost"
                  value={costUsd == null ? "—" : `$${costUsd.toFixed(2)}`}
                  meta={
                    totalTokens == null
                      ? "next run"
                      : `${formatCompact(totalTokens)} tokens`
                  }
                />
              </div>

              <div className="mt-5 grid w-full grid-cols-2 gap-2 sm:flex sm:flex-wrap">
                {tabs.map((tab) => {
                  const Icon = tab.icon;
                  const active = activeTab === tab.id;
                  return (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => setActiveTab(tab.id)}
                      className={`h-10 min-w-0 rounded-md border px-3 text-[12px] font-medium transition sm:w-auto ${
                        tab.id === "report" ? "col-span-2" : ""
                      } ${
                        active
                          ? "border-accent-primary/40 bg-accent-primary/[0.12] text-fg"
                          : "border-fg/[0.06] bg-ink-900 text-fg-muted hover:bg-ink-700 hover:text-fg-dim"
                      }`}
                    >
                      <span className="inline-flex max-w-full items-center justify-center gap-1.5 truncate">
                        <Icon size={14} />
                        <span className="truncate">{tab.label}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </header>

            {activeTab === "brief" && (
              <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1.05fr)_minmax(320px,0.95fr)]">
                <section className="min-w-0 rounded-lg border border-fg/[0.06] bg-ink-800 p-4 card-warm">
                  <div className="micro text-fg-muted">Research questions</div>
                  <div className="mt-3 space-y-2">
                    {questions.map((q) => (
                      <div
                        key={q.id}
                        className="rounded-md border border-fg/[0.06] bg-ink-900 p-3"
                      >
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-[11px] text-accent-primary">
                            {q.id}
                          </span>
                          {q.category && (
                            <span className="truncate text-[11px] text-fg-muted">
                              {q.category}
                            </span>
                          )}
                        </div>
                        <div className="mt-1 text-[13px] leading-relaxed text-fg-dim">
                          {q.question}
                        </div>
                        {Array.isArray(q.subquestions) && q.subquestions.length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {q.subquestions.slice(0, 5).map((s: any) => (
                              <span
                                key={s.id}
                                className="rounded-full bg-ink-700 px-2 py-0.5 font-mono text-[10px] text-fg-muted"
                              >
                                {s.id}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </section>

                <section className="min-w-0 rounded-lg border border-fg/[0.06] bg-ink-800 p-4 card-warm">
                  <div className="micro text-fg-muted">Brief</div>
                  <div className="mt-3 space-y-3 text-[13px] leading-relaxed text-fg-dim">
                    {constraints.length ? (
                      <div>
                        <div className="mb-1 text-[11px] uppercase text-fg-muted">
                          Constraints
                        </div>
                        <ul className="space-y-1">
                          {constraints.map((c: string) => (
                            <li key={c} className="flex gap-2">
                              <Check
                                size={14}
                                className="mt-0.5 shrink-0 text-accent-sage"
                              />
                              <span>{c}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                    {scopeNotes.length ? (
                      <div>
                        <div className="mb-1 text-[11px] uppercase text-fg-muted">
                          Scope notes
                        </div>
                        <ul className="space-y-1">
                          {scopeNotes.map((note: string) => (
                            <li key={note}>{note}</li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                    {analysisReport?.overall_summary && (
                      <div>
                        <div className="mb-1 text-[11px] uppercase text-fg-muted">
                          Current read
                        </div>
                        <p>{analysisReport.overall_summary}</p>
                      </div>
                    )}
                  </div>
                </section>
              </div>
            )}

            {activeTab === "claims" && (
              <section className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,0.92fr)_minmax(360px,0.68fr)]">
                <div className="min-w-0 rounded-lg border border-fg/[0.06] bg-ink-800 p-4 card-warm">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="micro text-fg-muted">Claims</div>
                      <div className="mt-1 text-[12px] text-fg-muted">
                        {visibleClaims.length}/{claimDetails.length} visible
                      </div>
                    </div>
                    <span className="rounded-full border border-fg/[0.06] bg-ink-900 px-2 py-1 text-[10.5px] text-fg-muted">
                      {project.epistemicGraph ? "epistemic graph" : "fallback"}
                    </span>
                  </div>

                  <div className="mt-4 grid gap-2 lg:grid-cols-[minmax(0,1fr)_150px]">
                    <label className="relative block min-w-0">
                      <Search
                        size={14}
                        className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-muted"
                      />
                      <input
                        value={claimQuery}
                        onChange={(e) => setClaimQuery(e.target.value)}
                        placeholder="Search claims, verdicts, questions..."
                        className="h-9 w-full rounded-md border border-fg/[0.06] bg-ink-900 pl-8 pr-3 text-[12px] text-fg-dim outline-none transition placeholder:text-fg-muted focus:border-accent-primary/40"
                      />
                    </label>
                    <select
                      value={claimStateFilter}
                      onChange={(e) => setClaimStateFilter(e.target.value)}
                      className="h-9 rounded-md border border-fg/[0.06] bg-ink-900 px-3 text-[12px] text-fg-dim outline-none"
                    >
                      <option value="all">All states</option>
                      <option value="verified">Verified</option>
                      <option value="blocked">Blocked</option>
                      <option value="contested">Contested</option>
                      <option value="unverified">Unverified</option>
                    </select>
                  </div>

                  <div className="mt-4 divide-y divide-fg/[0.06] overflow-hidden rounded-md border border-fg/[0.06]">
                    {visibleClaims.slice(0, 80).map((claim) => {
                      const selected = selectedClaim?.id === claim.id;
                      return (
                        <button
                          key={claim.id}
                          type="button"
                          onClick={() => setSelectedClaimId(claim.id)}
                          className={`block w-full min-w-0 bg-ink-900 p-3 text-left transition hover:bg-ink-700 ${
                            selected ? "bg-accent-primary/[0.08]" : ""
                          }`}
                        >
                          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                            <span className="font-mono text-[10.5px] text-accent-primary">
                              {claim.id}
                            </span>
                            <span
                              className={`rounded-full border px-2 py-0.5 text-[10.5px] ${lifecycleTone(
                                claim.state
                              )}`}
                            >
                              {claim.state}
                            </span>
                            <span className="rounded-full bg-ink-700 px-2 py-0.5 text-[10.5px] text-fg-muted">
                              {claim.verdict}
                            </span>
                            {claim.confidence != null && (
                              <span className="rounded-full bg-ink-700 px-2 py-0.5 text-[10.5px] text-fg-muted">
                                {claim.confidence}%
                              </span>
                            )}
                          </div>
                          <div className="mt-2 line-clamp-2 text-[12.5px] leading-relaxed text-fg-dim">
                            {claim.statement}
                          </div>
                          <div className="mt-2 flex min-w-0 flex-wrap gap-1.5 text-[10.5px] text-fg-muted">
                            <span className="rounded-full bg-ink-700 px-2 py-0.5">
                              {claim.questionId}
                              {claim.subquestionId ? `:${claim.subquestionId}` : ""}
                            </span>
                            <span className="rounded-full bg-ink-700 px-2 py-0.5">
                              {claim.evidence.length} evidence
                            </span>
                            {claim.dependencies.openQuestions.length > 0 && (
                              <span className="rounded-full bg-accent-amber/10 px-2 py-0.5 text-accent-amber">
                                debt
                              </span>
                            )}
                            {claim.dependencies.isKeyFact && (
                              <span className="rounded-full bg-accent-primary/10 px-2 py-0.5 text-accent-primary">
                                key
                              </span>
                            )}
                          </div>
                        </button>
                      );
                    })}
                    {visibleClaims.length === 0 && (
                      <div className="bg-ink-900 p-4 text-[13px] text-fg-muted">
                        No claims match the current filters.
                      </div>
                    )}
                  </div>
                </div>

                <aside className="min-w-0 rounded-lg border border-fg/[0.06] bg-ink-800 p-4 card-warm xl:sticky xl:top-6 xl:self-start">
                  {selectedClaim ? (
                    <div className="min-w-0 space-y-4">
                      <div>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="font-mono text-[11px] text-accent-primary">
                            {selectedClaim.id}
                          </span>
                          <span
                            className={`rounded-full border px-2 py-0.5 text-[10.5px] ${lifecycleTone(
                              selectedClaim.state
                            )}`}
                          >
                            {selectedClaim.state}
                          </span>
                          <span className="rounded-full bg-ink-700 px-2 py-0.5 text-[10.5px] text-fg-muted">
                            {selectedClaim.verdict}
                          </span>
                        </div>
                        <div className="mt-3 text-[15px] leading-relaxed text-fg">
                          {selectedClaim.statement}
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-2">
                        <div className="rounded-md bg-ink-900 p-3">
                          <div className="micro text-fg-muted">Confidence</div>
                          <div className="tnum mt-2 text-xl font-semibold text-fg">
                            {selectedClaim.confidence == null
                              ? "—"
                              : `${selectedClaim.confidence}%`}
                          </div>
                        </div>
                        <div className="rounded-md bg-ink-900 p-3">
                          <div className="micro text-fg-muted">Coverage</div>
                          <div className="mt-2 text-[13px] text-fg-dim">
                            {selectedClaim.dependencies.questionCoverage.replace(/_/g, " ")}
                          </div>
                        </div>
                      </div>

                      <div className="rounded-md border border-fg/[0.06] bg-ink-900 p-3">
                        <div className="micro text-fg-muted">Dependencies</div>
                        <div className="mt-3 flex flex-wrap gap-1.5">
                          <span className="rounded-full bg-ink-700 px-2 py-0.5 text-[10.5px] text-fg-muted">
                            {selectedClaim.questionId}
                            {selectedClaim.subquestionId
                              ? `:${selectedClaim.subquestionId}`
                              : ""}
                          </span>
                          {selectedClaim.factuality && (
                            <span className="rounded-full bg-ink-700 px-2 py-0.5 text-[10.5px] text-fg-muted">
                              {selectedClaim.factuality}
                            </span>
                          )}
                          {selectedClaim.dependencies.sourceHosts
                            .filter(Boolean)
                            .slice(0, 4)
                            .map((host: string) => (
                              <span
                                key={host}
                                className="rounded-full bg-ink-700 px-2 py-0.5 text-[10.5px] text-fg-muted"
                              >
                                {host}
                              </span>
                            ))}
                          {selectedClaim.dependencies.conflictingFacts.map((factId: string) => (
                            <button
                              key={factId}
                              type="button"
                              onClick={() => setSelectedClaimId(factId)}
                              className="rounded-full bg-accent-amber/10 px-2 py-0.5 text-[10.5px] text-accent-amber transition hover:bg-accent-amber/20"
                            >
                              conflicts {factId}
                            </button>
                          ))}
                        </div>
                      </div>

                      <div>
                        <div className="micro text-fg-muted">Evidence</div>
                        <div className="mt-3 space-y-2">
                          {selectedClaim.evidence.slice(0, 5).map((evidence: any, i: number) => (
                            <a
                              key={`${evidence.url}-${i}`}
                              href={evidence.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="block min-w-0 rounded-md border border-fg/[0.06] bg-ink-900 p-3 transition hover:bg-ink-700"
                            >
                              <div className="flex min-w-0 items-start justify-between gap-3">
                                <div className="min-w-0">
                                  <div className="line-clamp-1 text-[12.5px] text-fg-dim">
                                    {evidence.title || hostOf(evidence.url)}
                                  </div>
                                  <div className="mt-1 truncate font-mono text-[10px] text-fg-muted">
                                    {hostOf(evidence.url)}
                                  </div>
                                </div>
                                <ExternalLink
                                  size={13}
                                  className="mt-0.5 shrink-0 text-fg-muted"
                                />
                              </div>
                              {evidence.exactQuote && (
                                <div className="mt-3 flex gap-2 text-[12px] leading-relaxed text-fg-muted">
                                  <Quote
                                    size={13}
                                    className="mt-0.5 shrink-0 text-accent-primary"
                                  />
                                  <span className="line-clamp-3">
                                    {evidence.exactQuote}
                                  </span>
                                </div>
                              )}
                              <div className="mt-2 flex flex-wrap gap-1.5">
                                {evidence.provider && (
                                  <span className="rounded-full bg-ink-700 px-2 py-0.5 text-[10px] text-fg-muted">
                                    {evidence.provider}
                                  </span>
                                )}
                                {evidence.sourceType && (
                                  <span className="rounded-full bg-ink-700 px-2 py-0.5 text-[10px] text-fg-muted">
                                    {evidence.sourceType}
                                  </span>
                                )}
                                {evidence.usefulness != null && (
                                  <span className="rounded-full bg-ink-700 px-2 py-0.5 text-[10px] text-fg-muted">
                                    usefulness {evidence.usefulness}/3
                                  </span>
                                )}
                              </div>
                            </a>
                          ))}
                          {selectedClaim.evidence.length === 0 && (
                            <div className="rounded-md bg-ink-900 p-3 text-[12px] text-fg-muted">
                              No evidence links recorded.
                            </div>
                          )}
                        </div>
                      </div>

                      {selectedClaim.counterevidence.length > 0 && (
                        <div>
                          <div className="micro text-fg-muted">Counterevidence</div>
                          <div className="mt-3 space-y-2">
                            {selectedClaim.counterevidence.map((counter: any, i: number) => (
                              <div
                                key={`${counter.kind}-${counter.factId ?? i}`}
                                className="rounded-md border border-accent-red/15 bg-accent-red/[0.04] p-3"
                              >
                                <div className="flex flex-wrap items-center gap-1.5">
                                  <X size={13} className="text-accent-red" />
                                  <span className="rounded-full bg-accent-red/10 px-2 py-0.5 text-[10.5px] text-accent-red">
                                    {counter.verdict ?? counter.kind}
                                  </span>
                                  {counter.severity && (
                                    <span className="rounded-full bg-ink-700 px-2 py-0.5 text-[10.5px] text-fg-muted">
                                      {counter.severity}
                                    </span>
                                  )}
                                  {counter.factId && (
                                    <button
                                      type="button"
                                      onClick={() => setSelectedClaimId(counter.factId)}
                                      className="rounded-full bg-accent-amber/10 px-2 py-0.5 text-[10.5px] text-accent-amber transition hover:bg-accent-amber/20"
                                    >
                                      {counter.factId}
                                    </button>
                                  )}
                                </div>
                                {counter.notes && (
                                  <div className="mt-2 text-[12px] leading-relaxed text-fg-dim">
                                    {counter.notes}
                                  </div>
                                )}
                                {counter.correctedStatement && (
                                  <div className="mt-2 rounded bg-ink-900 px-2 py-1.5 text-[12px] leading-relaxed text-fg-muted">
                                    {counter.correctedStatement}
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {selectedClaim.dependencies.openQuestions.length > 0 && (
                        <div>
                          <div className="micro text-fg-muted">Research debt</div>
                          <div className="mt-3 space-y-2">
                            {selectedClaim.dependencies.openQuestions
                              .slice(0, 6)
                              .map((item: string, i: number) => (
                                <div
                                  key={`${selectedClaim.id}-debt-${i}`}
                                  className="rounded-md bg-ink-900 p-3 text-[12px] leading-relaxed text-fg-dim"
                                >
                                  {item}
                                </div>
                              ))}
                          </div>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="rounded-md bg-ink-900 p-4 text-[13px] text-fg-muted">
                      No claims available.
                    </div>
                  )}
                </aside>
              </section>
            )}

            {activeTab === "cognition" && (
              <section className="min-w-0 space-y-4">
                <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(280px,0.55fr)]">
                  <div className="rounded-lg border border-fg/[0.06] bg-ink-800 p-4 card-warm">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="micro text-fg-muted">Evidence control loop</div>
                        <div className="mt-1 text-[13px] text-fg-dim">
                          Plan → sources → facts → verification → analysis → report
                        </div>
                      </div>
                      <ShieldCheck size={18} className="shrink-0 text-accent-sage" />
                    </div>
                    <div className="mt-4 grid gap-2 sm:grid-cols-2">
                      {[
                        ["Question-first", `${questions.length} questions before harvesting`],
                        ["Source-bounded", `${sourceRows.length} source rows mapped to subquestions`],
                        ["Quote-bound", `${facts.length} extracted facts before synthesis`],
                        ["Verified-only", `${verifiedFacts} facts allowed into synthesis`],
                        ["Rejection visible", `${rejectedFacts} facts blocked or downgraded`],
                        ["Gap-aware", `${weakAnswers.length} weak answers remain explicit`],
                      ].map(([label, value]) => (
                        <div
                          key={label}
                          className="rounded-md border border-fg/[0.06] bg-ink-900 p-3"
                        >
                          <div className="text-[11px] uppercase text-fg-muted">
                            {label}
                          </div>
                          <div className="mt-1 text-[13px] text-fg-dim">{value}</div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="rounded-lg border border-fg/[0.06] bg-ink-800 p-4 card-warm">
                    <div className="micro text-fg-muted">Trust budget</div>
                    <div className="mt-4 space-y-3">
                      <div>
                        <div className="flex justify-between text-[12px] text-fg-muted">
                          <span>Coverage</span>
                          <span className="tnum">{coveragePct}%</span>
                        </div>
                        <div className="mt-1 h-2 overflow-hidden rounded-full bg-ink-900">
                          <div
                            className="h-full rounded-full bg-accent-primary"
                            style={{ width: `${coveragePct}%` }}
                          />
                        </div>
                      </div>
                      <div>
                        <div className="flex justify-between text-[12px] text-fg-muted">
                          <span>Verification</span>
                          <span className="tnum">{verifiedPct}%</span>
                        </div>
                        <div className="mt-1 h-2 overflow-hidden rounded-full bg-ink-900">
                          <div
                            className="h-full rounded-full bg-accent-sage"
                            style={{ width: `${verifiedPct}%` }}
                          />
                        </div>
                      </div>
                      <div className="rounded-md bg-ink-900 px-3 py-2 text-[12px] text-fg-muted">
                        Evidence density:{" "}
                        <span className="tnum text-fg-dim">
                          {questions.length
                            ? (verifiedFacts / questions.length).toFixed(1)
                            : "0.0"}
                        </span>{" "}
                        verified facts per question
                      </div>
                    </div>
                  </div>
                </div>

                <div className="grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)]">
                  <div className="rounded-lg border border-fg/[0.06] bg-ink-800 p-4 card-warm">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <div className="micro text-fg-muted">Claim lifecycle</div>
                        <div className="mt-1 text-[12px] text-fg-muted">
                          Claims are tracked as objects: evidence, confidence, verification, debt.
                        </div>
                      </div>
                      <span className="rounded-full border border-fg/[0.06] bg-ink-900 px-2 py-1 text-[10.5px] text-fg-muted">
                        {claimLifecycle.length} claims
                      </span>
                    </div>
                    <div className="mt-4 divide-y divide-fg/[0.06] overflow-hidden rounded-md border border-fg/[0.06]">
                      {claimLifecycle.slice(0, 8).map((claim) => (
                        <div key={claim.id} className="min-w-0 bg-ink-900 p-3">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="font-mono text-[10.5px] text-accent-primary">
                              {claim.id}
                            </span>
                            <span
                              className={`rounded-full border px-2 py-0.5 text-[10.5px] ${lifecycleTone(
                                claim.state
                              )}`}
                            >
                              {claim.state}
                            </span>
                            {claim.confidence != null && (
                              <span className="rounded-full bg-ink-700 px-2 py-0.5 text-[10.5px] text-fg-muted">
                                {claim.confidence}% confidence
                              </span>
                            )}
                            {claim.keyFact && (
                              <span className="rounded-full bg-accent-primary/10 px-2 py-0.5 text-[10.5px] text-accent-primary">
                                key
                              </span>
                            )}
                          </div>
                          <div className="mt-2 line-clamp-2 text-[12.5px] leading-relaxed text-fg-dim">
                            {claim.statement}
                          </div>
                          <div className="mt-2 flex flex-wrap gap-1.5 text-[10.5px] text-fg-muted">
                            <span className="rounded-full bg-ink-700 px-2 py-0.5">
                              {claim.questionId}
                              {claim.subquestionId ? `:${claim.subquestionId}` : ""}
                            </span>
                            <span className="rounded-full bg-ink-700 px-2 py-0.5">
                              {claim.evidenceCount} evidence link
                              {claim.evidenceCount === 1 ? "" : "s"}
                            </span>
                            {claim.sourceHost && (
                              <span className="rounded-full bg-ink-700 px-2 py-0.5">
                                {claim.sourceHost}
                              </span>
                            )}
                            {claim.verdict !== claim.state && (
                              <span className="rounded-full bg-ink-700 px-2 py-0.5">
                                verdict: {claim.verdict}
                              </span>
                            )}
                          </div>
                        </div>
                      ))}
                      {claimLifecycle.length === 0 && (
                        <div className="bg-ink-900 p-4 text-[13px] text-fg-muted">
                          Claim objects will appear after evidence extraction.
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="rounded-lg border border-fg/[0.06] bg-ink-800 p-4 card-warm">
                    <div className="micro text-fg-muted">Research debt</div>
                    <div className="mt-1 text-[12px] text-fg-muted">
                      Unknowns and next checks that should survive the report.
                    </div>
                    <div className="mt-4 space-y-2">
                      {researchDebt.slice(0, 8).map((debt, i) => (
                        <div
                          key={`${debt.questionId}-${debt.kind}-${i}`}
                          className="rounded-md border border-fg/[0.06] bg-ink-900 p-3"
                        >
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="font-mono text-[10.5px] text-accent-primary">
                              {debt.questionId}
                            </span>
                            <span className="rounded-full bg-ink-700 px-2 py-0.5 text-[10.5px] text-fg-muted">
                              {debt.kind}
                            </span>
                            <span
                              className={`rounded-full px-2 py-0.5 text-[10.5px] ${
                                debt.severity === "high"
                                  ? "bg-accent-red/10 text-accent-red"
                                  : debt.severity === "medium"
                                    ? "bg-accent-amber/10 text-accent-amber"
                                    : "bg-accent-sage/10 text-accent-sage"
                              }`}
                            >
                              {debt.severity}
                            </span>
                          </div>
                          <div className="mt-2 text-[12.5px] leading-relaxed text-fg-dim">
                            {debt.text}
                          </div>
                        </div>
                      ))}
                      {researchDebt.length === 0 && (
                        <div className="rounded-md bg-ink-900 p-4 text-[13px] text-fg-muted">
                          No explicit research debt was extracted.
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                <div className="rounded-lg border border-fg/[0.06] bg-ink-800 p-4 card-warm">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="micro text-fg-muted">Contradiction resolver</div>
                      <div className="mt-1 text-[12px] text-fg-muted">
                        Disagreements are treated as resolution tasks, not averaged away.
                      </div>
                    </div>
                    <span className="rounded-full border border-fg/[0.06] bg-ink-900 px-2 py-1 text-[10.5px] text-fg-muted">
                      {contradictionMap.length} active tensions
                    </span>
                  </div>
                  <div className="mt-4 grid gap-2 lg:grid-cols-2">
                    {contradictionMap.slice(0, 6).map((item, i) => (
                      <div
                        key={`${item.scope}-${item.label}-${i}`}
                        className="rounded-md border border-fg/[0.06] bg-ink-900 p-3"
                      >
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="rounded-full bg-accent-amber/10 px-2 py-0.5 text-[10.5px] text-accent-amber">
                            {item.verdict === "different_context"
                              ? "Different context"
                              : item.scope}
                          </span>
                          {item.label && (
                            <span className="font-mono text-[10.5px] text-fg-muted">
                              {item.label}
                            </span>
                          )}
                        </div>
                        <div className="mt-2 text-[12.5px] leading-relaxed text-fg-dim">
                          {item.difference}
                        </div>
                        {item.facts && (
                          <div className="mt-2 font-mono text-[10.5px] text-fg-muted">
                            {item.facts}
                          </div>
                        )}
                        <div className="mt-3 flex flex-wrap items-center gap-1.5">
                          {item.confidence != null && (
                            <span className="rounded-full bg-ink-700 px-2 py-0.5 text-[10.5px] text-fg-muted">
                              {item.confidence}% confidence
                            </span>
                          )}
                          {item.resolutionAxes.slice(0, 4).map((axis: string) => (
                            <span
                              key={axis}
                              className="rounded-full bg-ink-700 px-2 py-0.5 text-[10.5px] text-fg-muted"
                            >
                              {axis.replace(/_/g, " ")}
                            </span>
                          ))}
                        </div>
                        <button
                          type="button"
                          disabled={followUpBusy === (item.nextCheck ?? item.difference)}
                          onClick={() =>
                            runFollowUp(
                              item.nextCheck ??
                                `Resolve this contradiction: ${item.difference}. Compare claims ${item.facts}; identify whether the difference comes from version, benchmark, workload, source type, date, metric, or scope.`,
                              "resolve-contradiction"
                            )
                          }
                          className="mt-3 inline-flex h-8 items-center rounded-md border border-fg/[0.06] bg-ink-800 px-3 text-[11.5px] font-medium text-fg-dim transition hover:bg-ink-700 disabled:opacity-50"
                        >
                          {followUpBusy === (item.nextCheck ?? item.difference)
                            ? "Starting..."
                            : "Run follow-up"}
                        </button>
                      </div>
                    ))}
                    {contradictionMap.length === 0 && (
                      <div className="rounded-md border border-fg/[0.06] bg-ink-900 p-4 text-[13px] text-fg-muted lg:col-span-2">
                        No explicit contradictions were detected. The next step is to add source-version and benchmark-workload resolution axes.
                      </div>
                    )}
                  </div>
                </div>

                <div className="rounded-lg border border-fg/[0.06] bg-ink-800 p-4 card-warm">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="micro text-fg-muted">Question audit</div>
                      <div className="mt-1 text-[12px] text-fg-muted">
                        Every answer keeps its evidence count and open uncertainty visible.
                      </div>
                    </div>
                    <a
                      href={`/api/projects/${slug}/audit?download=1`}
                      className="inline-flex h-8 items-center gap-1.5 rounded-md border border-fg/[0.06] bg-ink-900 px-3 text-[12px] transition hover:bg-ink-700"
                    >
                      <Download size={13} />
                      Export audit
                    </a>
                  </div>
                  <div className="mt-4 overflow-hidden rounded-md border border-fg/[0.06]">
                    {questions.map((q) => {
                      const coverage = String(answerCoverage.get(q.id) ?? "pending");
                      return (
                        <div
                          key={q.id}
                          className="grid gap-2 border-b border-fg/[0.06] bg-ink-900 p-3 last:border-b-0 md:grid-cols-[70px_minmax(0,1fr)_auto]"
                        >
                          <div className="font-mono text-[11px] text-accent-primary">
                            {q.id}
                          </div>
                          <div className="min-w-0">
                            <div className="line-clamp-2 text-[13px] text-fg-dim">
                              {q.question}
                            </div>
                            <div className="mt-2 flex flex-wrap gap-1.5">
                              {(q.subquestions ?? []).slice(0, 4).map((sq: any) => (
                                <span
                                  key={sq.id}
                                  className="rounded-full bg-ink-700 px-2 py-0.5 font-mono text-[10px] text-fg-muted"
                                >
                                  {sq.id} · {sq.angle}
                                </span>
                              ))}
                            </div>
                          </div>
                          <div className="flex flex-wrap items-start gap-1.5 md:justify-end">
                            <span
                              className={`rounded-full border px-2 py-0.5 text-[10.5px] ${coverageTone(
                                coverage
                              )}`}
                            >
                              {coverage.replace(/_/g, " ")}
                            </span>
                            <span className="rounded-full bg-ink-700 px-2 py-0.5 text-[10.5px] text-fg-muted">
                              {verifiedByQuestion.get(q.id) ?? 0}/
                              {factsByQuestion.get(q.id) ?? 0} facts
                            </span>
                            <span className="rounded-full bg-ink-700 px-2 py-0.5 text-[10.5px] text-fg-muted">
                              {sourceRowsByQuestion.get(q.id) ?? 0} sources
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {openFollowUps.length > 0 && (
                  <div className="rounded-lg border border-fg/[0.06] bg-ink-800 p-4 card-warm">
                    <div className="micro text-fg-muted">Next investigations</div>
                    <div className="mt-3 grid gap-2 lg:grid-cols-2">
                      {openFollowUps.slice(0, 8).map((f, i) => (
                        <div
                          key={`${f.questionId}-${i}`}
                          className="rounded-md border border-fg/[0.06] bg-ink-900 p-3"
                        >
                          <div className="font-mono text-[10.5px] text-accent-primary">
                            {f.questionId}
                          </div>
                          <div className="mt-1 text-[12.5px] leading-relaxed text-fg-dim">
                            {f.text}
                          </div>
                          <button
                            type="button"
                            onClick={() =>
                              copyText(`Deep research follow-up for ${plan.topic}: ${f.text}`)
                            }
                            className="mt-2 inline-flex items-center gap-1 rounded border border-fg/[0.06] px-2 py-1 text-[11px] text-fg-muted transition hover:bg-ink-700 hover:text-fg-dim"
                          >
                            <Copy size={12} />
                            Copy prompt
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </section>
            )}

            {activeTab === "sources" && (
              <section className="min-w-0 rounded-lg border border-fg/[0.06] bg-ink-800 p-4 card-warm">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="micro text-fg-muted">Source review</div>
                    <div className="mt-1 text-[12px] text-fg-muted">
                      {totalSources} sources across {questions.length} questions
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {Object.entries(byProvider)
                      .slice(0, 5)
                      .map(([provider, count]) => (
                        <span
                          key={provider}
                          className="rounded-full border border-fg/[0.06] bg-ink-900 px-2 py-1 font-mono text-[10.5px] text-fg-muted"
                        >
                          {provider}: {count}
                        </span>
                      ))}
                  </div>
                </div>

                <div className="mt-4 grid gap-2 lg:grid-cols-[minmax(0,1fr)_180px_150px]">
                  <label className="relative block min-w-0">
                    <Search
                      size={14}
                      className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-muted"
                    />
                    <input
                      value={sourceQuery}
                      onChange={(e) => setSourceQuery(e.target.value)}
                      placeholder="Search title, URL, question…"
                      className="h-9 w-full rounded-md border border-fg/[0.06] bg-ink-900 pl-8 pr-3 text-[12px] text-fg-dim outline-none transition placeholder:text-fg-muted focus:border-accent-primary/40"
                    />
                  </label>
                  <select
                    value={providerFilter}
                    onChange={(e) => setProviderFilter(e.target.value)}
                    className="h-9 rounded-md border border-fg/[0.06] bg-ink-900 px-3 text-[12px] text-fg-dim outline-none"
                  >
                    <option value="all">All providers</option>
                    {providerOptions.map((provider) => (
                      <option key={provider} value={provider}>
                        {provider}
                      </option>
                    ))}
                  </select>
                  <select
                    value={sourceQuality}
                    onChange={(e) =>
                      setSourceQuality(e.target.value as "all" | "useful")
                    }
                    className="h-9 rounded-md border border-fg/[0.06] bg-ink-900 px-3 text-[12px] text-fg-dim outline-none"
                  >
                    <option value="all">All quality</option>
                    <option value="useful">Useful 2+</option>
                  </select>
                </div>

                <div className="mt-4 divide-y divide-fg/[0.06] overflow-hidden rounded-md border border-fg/[0.06]">
                  {visibleSources.slice(0, 40).map((source) => (
                    <a
                      key={source.key}
                      href={source.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block min-w-0 bg-ink-900 p-3 transition hover:bg-ink-700"
                    >
                      <div className="flex min-w-0 items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="line-clamp-1 text-[13px] text-fg-dim">
                            {source.title}
                          </div>
                          <div className="mt-1 truncate font-mono text-[10.5px] text-fg-muted">
                            {hostOf(source.url)}
                          </div>
                        </div>
                        <span className="inline-flex shrink-0 items-center gap-1 rounded bg-ink-700 px-2 py-0.5 text-[10.5px] text-fg-muted">
                          {source.provider}
                          <ExternalLink size={11} />
                        </span>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {source.questionId && (
                          <span className="rounded-full bg-accent-primary/10 px-2 py-0.5 font-mono text-[10px] text-accent-primary">
                            {source.questionId}
                            {source.subquestionId ? `:${source.subquestionId}` : ""}
                          </span>
                        )}
                        {source.usefulness != null && (
                          <span className="rounded-full bg-ink-700 px-2 py-0.5 text-[10px] text-fg-muted">
                            usefulness {source.usefulness}/3
                          </span>
                        )}
                        {source.domainMatch && (
                          <span className="rounded-full bg-ink-700 px-2 py-0.5 text-[10px] text-fg-muted">
                            {source.domainMatch}
                          </span>
                        )}
                        {source.type && (
                          <span className="rounded-full bg-ink-700 px-2 py-0.5 text-[10px] text-fg-muted">
                            {source.type}
                          </span>
                        )}
                      </div>
                    </a>
                  ))}
                  {visibleSources.length === 0 && (
                    <div className="bg-ink-900 p-4 text-[13px] text-fg-muted">
                      No sources match the current filters.
                    </div>
                  )}
                </div>
              </section>
            )}

            {activeTab === "coverage" && (
              <section className="min-w-0 rounded-lg border border-fg/[0.06] bg-ink-800 p-4 card-warm">
                <div className="micro text-fg-muted">Coverage map</div>
                <div className="mt-4 grid gap-3 lg:grid-cols-2">
                  {questions.map((q) => {
                    const answer = answers.find((a) => a.question_id === q.id);
                    const coverage = answer?.coverage ?? "pending";
                    return (
                      <div
                        key={q.id}
                        className="min-w-0 rounded-md border border-fg/[0.06] bg-ink-900 p-3"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-mono text-[11px] text-accent-primary">
                            {q.id}
                          </span>
                          <span
                            className={`rounded-full border px-2 py-0.5 text-[10.5px] ${coverageTone(
                              coverage
                            )}`}
                          >
                            {String(coverage).replace(/_/g, " ")}
                          </span>
                        </div>
                        <div className="mt-2 line-clamp-2 text-[13px] text-fg-dim">
                          {q.question}
                        </div>
                        {answer?.gaps?.length ? (
                          <div className="mt-3 space-y-1 text-[12px] text-fg-muted">
                            {answer.gaps.slice(0, 2).map((gap: string) => (
                              <div key={gap} className="flex gap-2">
                                <AlertTriangle
                                  size={13}
                                  className="mt-0.5 shrink-0 text-accent-amber"
                                />
                                <span className="line-clamp-2">{gap}</span>
                              </div>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </section>
            )}

            {activeTab === "versions" && (
              <section className="min-w-0 rounded-lg border border-fg/[0.06] bg-ink-800 p-4 card-warm">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="micro text-fg-muted">Versions</div>
                    <div className="mt-1 text-[12px] text-fg-muted">
                      Branches created through Extend and Compare workflows
                    </div>
                  </div>
                  {viewerUid && <ComparePicker slug={slug} />}
                </div>

                <div className="mt-4 grid gap-3 lg:grid-cols-3">
                  <div className="rounded-md border border-accent-primary/20 bg-accent-primary/[0.04] p-3">
                    <div className="text-[11px] uppercase text-accent-primary">
                      Current
                    </div>
                    <div className="mt-1 line-clamp-2 text-[13px] text-fg-dim">
                      {plan.topic}
                    </div>
                    <div className="mt-2 font-mono text-[10.5px] text-fg-muted">
                      {slug}
                    </div>
                  </div>
                  {branches.parent && (
                    <div>
                      <div className="mb-2 text-[11px] uppercase text-fg-muted">
                        Parent
                      </div>
                      <BranchRow project={branches.parent} />
                    </div>
                  )}
                  {branches.children.length > 0 && (
                    <div>
                      <div className="mb-2 text-[11px] uppercase text-fg-muted">
                        Children
                      </div>
                      <div className="space-y-2">
                        {branches.children.slice(0, 4).map((b) => (
                          <BranchRow key={b.slug} project={b} />
                        ))}
                      </div>
                    </div>
                  )}
                  {branches.siblings.length > 0 && (
                    <div>
                      <div className="mb-2 text-[11px] uppercase text-fg-muted">
                        Siblings
                      </div>
                      <div className="space-y-2">
                        {branches.siblings.slice(0, 4).map((b) => (
                          <BranchRow key={b.slug} project={b} />
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {!branches.parent &&
                  branches.children.length === 0 &&
                  branches.siblings.length === 0 && (
                    <div className="mt-4 rounded-md border border-fg/[0.06] bg-ink-900 p-4 text-[13px] text-fg-muted">
                      No related branches yet.
                    </div>
                  )}
              </section>
            )}

            {activeTab === "report" && (
              <ProjectDocument
                project={project}
                slug={slug}
                canEdit={canEdit}
                branches={branches}
              />
            )}
          </section>

          <aside className="min-w-0 space-y-4 xl:sticky xl:top-6 xl:self-start">
            <section className="rounded-lg border border-fg/[0.06] bg-ink-800 p-4 card-warm">
              <div className="micro text-fg-muted">Actions</div>
              <div className="mt-3 grid grid-cols-2 gap-2 xl:grid-cols-1">
                <a
                  href={`/api/projects/${slug}/pdf`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex h-9 min-w-0 items-center justify-center gap-1.5 rounded-md border border-fg/[0.06] bg-ink-900 px-3 text-[12px] font-medium transition hover:bg-ink-700"
                >
                  <Download size={14} />
                  PDF
                </a>
                <a
                  href={`/api/projects/${slug}/report?download=1`}
                  className="inline-flex h-9 min-w-0 items-center justify-center gap-1.5 rounded-md border border-fg/[0.06] bg-ink-900 px-3 text-[12px] font-medium transition hover:bg-ink-700"
                >
                  <FileText size={14} />
                  Markdown
                </a>
                <a
                  href={`/api/projects/${slug}/audit?download=1`}
                  className="inline-flex h-9 min-w-0 items-center justify-center gap-1.5 rounded-md border border-fg/[0.06] bg-ink-900 px-3 text-[12px] font-medium transition hover:bg-ink-700"
                >
                  <ShieldCheck size={14} />
                  Audit JSON
                </a>
                <ProjectRerunButton topic={plan.topic} />
                {viewerUid && <ForkButton slug={slug} sourceTopic={plan.topic} />}
                {viewerUid &&
                  project.owner_uid != null &&
                  (project.owner_uid === viewerUid || isViewerAdmin) && (
                    <ShareButton slug={slug} />
                  )}
                <ProjectAdminActions slug={slug} ownerUid={project.owner_uid} />
              </div>
            </section>

            <section className="rounded-lg border border-fg/[0.06] bg-ink-800 p-4 card-warm">
              <div className="micro text-fg-muted">Pipeline</div>
              <div className="mt-3 space-y-2">
                {phaseRows(project).map(([label, done]) => (
                  <div
                    key={label}
                    className="flex items-center justify-between gap-3 rounded-md bg-ink-900 px-3 py-2"
                  >
                    <span className="text-[12px] text-fg-dim">{label}</span>
                    <span
                      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] ${
                        done
                          ? "bg-accent-sage/10 text-accent-sage"
                          : "bg-ink-700 text-fg-muted"
                      }`}
                    >
                      {done ? <Check size={12} /> : <Sparkles size={12} />}
                      {done ? "done" : "pending"}
                    </span>
                  </div>
                ))}
              </div>
            </section>

            <section className="rounded-lg border border-fg/[0.06] bg-ink-800 p-4 card-warm">
              <div className="micro text-fg-muted">Audit</div>
              <div className="mt-3 space-y-2 text-[12px] text-fg-muted">
                <div className="flex items-center justify-between gap-3">
                  <span>Verified facts</span>
                  <span className="tnum text-fg-dim">
                    {verifiedFacts}/{totalFacts || 0}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span>Cross-question tensions</span>
                  <span className="tnum text-fg-dim">
                    {analysisReport?.cross_question_tensions?.length ?? 0}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span>Source rows</span>
                  <span className="tnum text-fg-dim">{sourceRows.length}</span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span>LLM calls</span>
                  <span className="tnum text-fg-dim">
                    {llmCalls == null ? "—" : llmCalls}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span>LLM tokens</span>
                  <span className="tnum text-fg-dim">
                    {totalTokens == null ? "—" : formatCompact(totalTokens)}
                  </span>
                </div>
              </div>
            </section>

            <section className="rounded-lg border border-fg/[0.06] bg-ink-800 p-4 card-warm">
              <div className="micro text-fg-muted">Usage</div>
              {usageTotals ? (
                <div className="mt-3 space-y-2">
                  <div className="flex items-end justify-between gap-3">
                    <div>
                      <div className="text-[12px] text-fg-muted">Estimated cost</div>
                      <div className="tnum mt-1 text-2xl font-semibold text-fg">
                        ${Number(usageTotals.estimated_cost_usd ?? 0).toFixed(2)}
                      </div>
                    </div>
                    <div className="text-right text-[11px] text-fg-muted">
                      <div>{formatCompact(Number(usageTotals.total_tokens ?? 0))} tokens</div>
                      <div>{Number(usageTotals.calls ?? 0)} calls</div>
                    </div>
                  </div>
                  {phaseUsage.length > 0 && (
                    <div className="mt-3 space-y-1.5">
                      {phaseUsage.slice(0, 6).map((p) => (
                        <div
                          key={p.phase}
                          className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-2 rounded-md bg-ink-900 px-2.5 py-2 text-[11px]"
                        >
                          <span className="truncate text-fg-dim">{p.phase}</span>
                          <span className="tnum text-fg-muted">
                            {formatCompact(p.tokens)}
                          </span>
                          <span className="tnum text-fg-dim">${p.cost.toFixed(2)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <div className="mt-3 rounded-md bg-ink-900 px-3 py-2 text-[12px] text-fg-muted">
                  Usage will appear after the next run.
                </div>
              )}
            </section>

            <section className="rounded-lg border border-fg/[0.06] bg-ink-800 p-4 card-warm">
              <div className="micro text-fg-muted">Share</div>
              <div className="mt-3 flex items-center gap-2 text-[12px] text-fg-muted">
                <Share2 size={14} className="text-fg-muted" />
                <span className="min-w-0 truncate">
                  {project.is_showcase ? "Showcase-visible" : "Private project"}
                </span>
              </div>
            </section>
          </aside>
        </div>
      </main>
    </div>
  );
}
