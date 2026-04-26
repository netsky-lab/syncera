"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ScopeChat, type Brief } from "@/components/scope-chat";

// Extend a research: spawn a new project that inherits the source's
// harvest + sources, then re-runs planner → evidence → analyze → synth
// against an extended topic ("same research + this additional angle").
// Two entry modes — Quick (textarea with a single angle string) and
// Discuss (scope-chat variant that clarifies the angle before submit).
export function ForkButton({
  slug,
  sourceTopic,
}: {
  slug: string;
  sourceTopic?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"quick" | "discuss">("quick");
  const [angle, setAngle] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function close() {
    setOpen(false);
    setAngle("");
    setName("");
    setError(null);
    setMode("quick");
  }

  async function submitAngle(finalAngle: string) {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(`/api/projects/${slug}/extend`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ angle: finalAngle, name: name.trim() }),
      });
      const d = await r.json();
      if (!r.ok) {
        setError(d.error ?? `HTTP ${r.status}`);
        setBusy(false);
        return;
      }
      router.push(`/projects/${d.slug}`);
    } catch (e: any) {
      setError(String(e?.message ?? e));
      setBusy(false);
    }
  }

  async function submitQuick() {
    if (angle.trim().length < 8) {
      setError("Describe the new angle (≥8 chars)");
      return;
    }
    await submitAngle(angle.trim());
  }

  async function onBriefReady(brief: Brief) {
    const combined = [
      brief.topic_refined,
      brief.domain_hints.length
        ? `Domain emphasis: ${brief.domain_hints.join(", ")}`
        : "",
      brief.constraints.length
        ? `Constraints: ${brief.constraints.join("; ")}`
        : "",
      brief.question_preview.length
        ? `Questions to cover: ${brief.question_preview.join(" | ")}`
        : "",
    ]
      .filter(Boolean)
      .join("\n");
    await submitAngle(combined);
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="h-9 px-3 rounded-md bg-ink-800 border border-fg/[0.06] hover:bg-ink-700 text-[12px] font-medium inline-flex items-center gap-1.5 transition"
        title="Start a new research that inherits this one's sources and adds an angle"
      >
        <svg
          width="13"
          height="13"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M6 3v12M6 21a3 3 0 100-6 3 3 0 000 6zM18 9a3 3 0 100-6 3 3 0 000 6zM6 15a9 9 0 009-9h3" />
        </svg>
        Extend
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-black/60 backdrop-blur-sm p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget && !busy) close();
          }}
        >
          <div className="w-full max-w-lg rounded-xl border border-accent-primary/30 bg-ink-800 p-5 space-y-3 shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-baseline justify-between gap-3">
              <div>
                <div className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-accent-primary mb-1">
                  Extend this research
                </div>
                <div className="text-[12.5px] text-fg-muted leading-relaxed">
                  Starts a new run that reuses this project&apos;s
                  harvested sources and regenerates plan + evidence +
                  analysis + report with your added angle. Typically 8–15 min.
                </div>
              </div>
              <button
                onClick={() => !busy && close()}
                disabled={busy}
                className="text-fg-muted hover:text-fg text-xl leading-none"
                aria-label="Close"
              >
                ×
              </button>
            </div>

            {/* Mode switch */}
            <div className="flex gap-1 p-1 rounded-md bg-ink-900 border border-ink-500 w-fit">
              <button
                onClick={() => setMode("quick")}
                disabled={busy}
                className={`text-[12px] px-3 py-1 rounded transition ${
                  mode === "quick"
                    ? "bg-ink-700 text-fg"
                    : "text-fg-muted hover:text-fg"
                }`}
              >
                Quick prompt
              </button>
              <button
                onClick={() => setMode("discuss")}
                disabled={busy}
                className={`text-[12px] px-3 py-1 rounded transition ${
                  mode === "discuss"
                    ? "bg-ink-700 text-fg"
                    : "text-fg-muted hover:text-fg"
                }`}
              >
                Discuss scope
              </button>
            </div>

            {mode === "quick" && (
              <>
                <label className="block space-y-1">
                  <div className="text-[11px] text-fg-muted">
                    Additional angle{" "}
                    <span className="text-fg-faint">
                      (what should the new report focus on / add / reframe)
                    </span>
                  </div>
                  <textarea
                    autoFocus
                    value={angle}
                    onChange={(e) => setAngle(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && (e.metaKey || e.ctrlKey))
                        submitQuick();
                      if (e.key === "Escape") close();
                    }}
                    disabled={busy}
                    rows={3}
                    placeholder="e.g. focus on pediatric safety; add comparison with retinoids; drop physics sources, reframe for skincare formulators"
                    className="w-full text-[13px] px-3 py-2 rounded-md bg-ink-900 border border-ink-500 text-fg placeholder:text-fg-muted focus:outline-none focus:border-accent-primary/60 resize-none"
                  />
                </label>
                <label className="block space-y-1">
                  <div className="text-[11px] text-fg-muted">
                    Short name for this branch{" "}
                    <span className="text-fg-faint">(optional)</span>
                  </div>
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    disabled={busy}
                    placeholder="e.g. marketing-focus, deep-safety"
                    className="w-full text-[13px] px-3 py-1.5 rounded-md bg-ink-900 border border-ink-500 text-fg placeholder:text-fg-muted focus:outline-none focus:border-accent-primary/60"
                  />
                </label>
                <div className="flex items-center gap-2 pt-1">
                  <button
                    onClick={submitQuick}
                    disabled={busy || angle.trim().length < 8}
                    className="text-[12px] font-semibold px-3.5 py-1.5 rounded-md bg-accent-primary text-ink-900 hover:brightness-110 disabled:opacity-50 transition"
                  >
                    {busy ? "starting…" : "Start extended run"}
                  </button>
                  <button
                    onClick={close}
                    disabled={busy}
                    className="text-[12px] text-fg-muted hover:text-fg transition"
                  >
                    cancel
                  </button>
                  <span className="ml-auto text-[11px] text-fg-muted font-mono">
                    ⌘+Enter
                  </span>
                </div>
              </>
            )}

            {mode === "discuss" && (
              <div className="space-y-2">
                <label className="block space-y-1">
                  <div className="text-[11px] text-fg-muted">
                    Short name for this branch{" "}
                    <span className="text-fg-faint">(optional)</span>
                  </div>
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    disabled={busy}
                    placeholder="e.g. marketing-focus"
                    className="w-full text-[13px] px-3 py-1.5 rounded-md bg-ink-900 border border-ink-500 text-fg placeholder:text-fg-muted focus:outline-none focus:border-accent-primary/60"
                  />
                </label>
                <ScopeChat
                  mode="extend"
                  sourceTopic={sourceTopic}
                  initialTopic={angle.trim() || "I want to extend this research. Ask me what angle."}
                  onCancel={close}
                  onBriefReady={onBriefReady}
                />
              </div>
            )}

            {error && (
              <div className="text-[12px] text-accent-red bg-accent-red/5 border border-accent-red/20 rounded-md px-2 py-1.5">
                {error}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
