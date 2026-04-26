"use client";

// Per-section "Tweak" flow: casual user types "simplify" / "no brands"
// into an inline textarea, we regenerate that one section via the
// synthesizer's per-section prompt with the hint appended, persist a
// variant, and show a switcher so they can flip between original and
// each saved version.
//
// Storage lives at projects/<slug>/variants/<section>_<ts>.json.

import { useEffect, useState } from "react";
import { Markdown } from "@/components/markdown";

type Variant = {
  id: string;
  section: string;
  hint: string;
  content: string;
  created_at: number;
};

export function SectionTweak({
  slug,
  section,
  sectionLabel,
  originalContent,
  canEdit,
  children,
}: {
  slug: string;
  section: "introduction" | "summary" | "recommendation" | "deployment" | "comparison";
  sectionLabel: string;
  originalContent: string;
  canEdit: boolean;
  children: React.ReactNode;
}) {
  const [variants, setVariants] = useState<Variant[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null); // null = original
  const [open, setOpen] = useState(false);
  const [hint, setHint] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let stopped = false;
    fetch(`/api/projects/${slug}/tweak`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (stopped || !d) return;
        const all: Variant[] = d.variants ?? [];
        setVariants(all.filter((v) => v.section === section));
      })
      .catch(() => {});
    return () => {
      stopped = true;
    };
  }, [slug, section]);

  async function submit() {
    if (!hint.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(`/api/projects/${slug}/tweak`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ section, hint: hint.trim() }),
      });
      const d = await r.json();
      if (!r.ok) {
        setError(d.error ?? `HTTP ${r.status}`);
        return;
      }
      setVariants((prev) => [d.variant, ...prev]);
      setActiveId(d.variant.id);
      setHint("");
      setOpen(false);
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally {
      setBusy(false);
    }
  }

  async function deleteVariant(id: string) {
    if (!confirm("Delete this variant? The switcher will fall back to the original.")) return;
    try {
      const r = await fetch(`/api/projects/${slug}/tweak/${id}`, {
        method: "DELETE",
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        alert(`Delete failed: ${d.error ?? r.status}`);
        return;
      }
      setVariants((prev) => prev.filter((v) => v.id !== id));
      if (activeId === id) setActiveId(null);
    } catch (e: any) {
      alert(String(e?.message ?? e));
    }
  }

  async function promoteVariant(id: string) {
    if (
      !confirm(
        "Make this variant the default? The original section text in REPORT.md will be replaced, and PDF / shared link / .md download will reflect this version going forward. The previous REPORT.md is backed up in variants/."
      )
    )
      return;
    try {
      const r = await fetch(`/api/projects/${slug}/tweak/${id}/promote`, {
        method: "POST",
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        alert(`Promote failed: ${d.error ?? r.status}`);
        return;
      }
      setVariants((prev) => prev.filter((v) => v.id !== id));
      setActiveId(null);
      // Nudge the user to reload so the underlying `children` prop
      // (which is the ORIGINAL section text) picks up from the new
      // REPORT.md on the server-rendered page.
      alert(
        "Promoted. Refresh the page to see the new default inline with the rest of the report."
      );
    } catch (e: any) {
      alert(String(e?.message ?? e));
    }
  }

  const active = variants.find((v) => v.id === activeId);

  const hasAny = variants.length > 0;

  return (
    <>
      {(canEdit || hasAny) && (
        <div className="flex items-center gap-2 flex-wrap mb-2 -mt-2">
          {hasAny && (
            <div className="flex items-center gap-1 flex-wrap">
              <button
                onClick={() => setActiveId(null)}
                className={`text-[11px] font-mono px-2 py-[3px] rounded-full border transition ${
                  !activeId
                    ? "border-accent-primary/40 bg-accent-primary/10 text-accent-primary"
                    : "border-ink-500 text-fg-muted hover:text-fg hover:border-ink-500"
                }`}
              >
                original
              </button>
              {variants.map((v, i) => (
                <div
                  key={v.id}
                  className={`inline-flex items-stretch rounded-full border transition ${
                    activeId === v.id
                      ? "border-accent-primary/40 bg-accent-primary/10"
                      : "border-ink-500 hover:border-ink-500"
                  }`}
                >
                  <button
                    onClick={() => setActiveId(v.id)}
                    title={v.hint}
                    className={`text-[11px] font-mono pl-2 pr-1.5 py-[3px] rounded-l-full max-w-[200px] truncate ${
                      activeId === v.id
                        ? "text-accent-primary"
                        : "text-fg-muted hover:text-fg"
                    }`}
                  >
                    v{variants.length - i} · {v.hint.slice(0, 28)}
                    {v.hint.length > 28 ? "…" : ""}
                  </button>
                  {canEdit && activeId === v.id && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        promoteVariant(v.id);
                      }}
                      title="Make this the default — overwrites REPORT.md"
                      className="px-1.5 text-accent-primary/70 hover:text-accent-primary text-[11px]"
                    >
                      ✓
                    </button>
                  )}
                  {canEdit && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteVariant(v.id);
                      }}
                      title="Delete this variant"
                      className={`px-1.5 rounded-r-full text-[12px] leading-none ${
                        activeId === v.id
                          ? "text-accent-primary/60 hover:text-accent-red"
                          : "text-fg-faint hover:text-accent-red"
                      }`}
                    >
                      ×
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
          {canEdit && (
            <button
              onClick={() => setOpen((s) => !s)}
              className="text-[11px] font-mono px-2 py-[3px] rounded-full border border-ink-500 text-fg-muted hover:text-accent-primary hover:border-accent-primary/40 transition"
              title="Regenerate this section with a custom instruction"
            >
              ✎ tweak
            </button>
          )}
        </div>
      )}

      {open && (
        <div className="mb-4 p-3 rounded-lg border border-accent-primary/30 bg-accent-primary/[0.03] space-y-2">
          <div className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-accent-primary">
            Tweak {sectionLabel}
          </div>
          <textarea
            value={hint}
            onChange={(e) => setHint(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit();
            }}
            disabled={busy}
            placeholder={PLACEHOLDER_BY_SECTION[section]}
            rows={2}
            className="w-full text-[13px] px-3 py-2 rounded-md bg-ink-900 border border-ink-500 text-fg placeholder:text-fg-muted focus:outline-none focus:border-accent-primary/60 resize-none"
          />
          <div className="flex items-center gap-2">
            <button
              onClick={submit}
              disabled={busy || !hint.trim()}
              className="text-[12px] font-semibold px-3 py-1.5 rounded-md bg-accent-primary text-ink-900 hover:brightness-110 disabled:opacity-50 transition"
            >
              {busy ? "regenerating…" : "Regenerate"}
            </button>
            <button
              onClick={() => {
                setOpen(false);
                setHint("");
                setError(null);
              }}
              disabled={busy}
              className="text-[12px] text-fg-muted hover:text-fg transition"
            >
              cancel
            </button>
            <span className="ml-auto text-[11px] text-fg-muted font-mono">
              ⌘+Enter
            </span>
          </div>
          {error && (
            <div className="text-[12px] text-accent-red bg-accent-red/5 border border-accent-red/20 rounded-md px-2 py-1.5">
              {error}
            </div>
          )}
        </div>
      )}

      {active ? (
        <div className="rl-summary-card">
          <Markdown content={active.content} />
        </div>
      ) : (
        children
      )}
    </>
  );
}

const PLACEHOLDER_BY_SECTION: Record<string, string> = {
  introduction: "e.g. shorter, or drop the GPU-budget framing",
  summary: "e.g. emphasize what evidence is MISSING, not what was found",
  recommendation:
    "e.g. don't recommend specific brand names, keep it device-agnostic",
  deployment: "e.g. 3 steps max, no CLI flags",
  comparison: "e.g. drop rows that don't apply to leave-on cosmetics",
};
