"use client";

import { useEffect, useState } from "react";

// Share-link management: mint a new token, list existing active tokens,
// revoke. Clicking Share opens a modal with the public URL to copy;
// owner/admin only (server enforces).
export function ShareButton({ slug }: { slug: string }) {
  const [open, setOpen] = useState(false);
  const [tokens, setTokens] = useState<any[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let stopped = false;
    fetch(`/api/projects/${slug}/share`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (stopped || !d) return;
        setTokens(d.tokens ?? []);
      })
      .catch(() => setError("Failed to load share links"));
    return () => {
      stopped = true;
    };
  }, [open, slug]);

  async function createToken() {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(`/api/projects/${slug}/share`, { method: "POST" });
      const d = await r.json();
      if (!r.ok) {
        setError(d.error ?? `HTTP ${r.status}`);
        return;
      }
      setTokens((prev) => {
        const existing = (prev ?? []).find((t) => t.token === d.token.token);
        return existing ? prev! : [d.token, ...(prev ?? [])];
      });
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally {
      setBusy(false);
    }
  }

  async function revoke(token: string) {
    if (!confirm("Revoke this link? Anyone currently using it will lose access.")) return;
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(`/api/projects/${slug}/share`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        setError(d.error ?? `HTTP ${r.status}`);
        return;
      }
      setTokens((prev) => (prev ?? []).filter((t) => t.token !== token));
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally {
      setBusy(false);
    }
  }

  function copy(url: string) {
    navigator.clipboard?.writeText(url);
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="h-9 px-3 rounded-md bg-ink-800 border border-fg/[0.06] hover:bg-ink-700 text-[12px] font-medium inline-flex items-center gap-1.5 transition"
        title="Mint a public read-only link to this project"
      >
        <svg
          width="13"
          height="13"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <circle cx="18" cy="5" r="3" />
          <circle cx="6" cy="12" r="3" />
          <circle cx="18" cy="19" r="3" />
          <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
          <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
        </svg>
        Share
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-black/60 backdrop-blur-sm p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget && !busy) setOpen(false);
          }}
        >
          <div className="w-full max-w-lg rounded-xl border border-accent-primary/30 bg-ink-800 p-5 space-y-3 shadow-2xl">
            <div className="flex items-baseline justify-between gap-3">
              <div>
                <div className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-accent-primary mb-1">
                  Share link
                </div>
                <div className="text-[12.5px] text-fg-muted leading-relaxed">
                  Anyone with the link sees a read-only version of this
                  report — no account needed. Revoke anytime.
                </div>
              </div>
              <button
                onClick={() => !busy && setOpen(false)}
                disabled={busy}
                className="text-fg-muted hover:text-fg text-xl leading-none"
              >
                ×
              </button>
            </div>

            {tokens === null ? (
              <div className="text-[12px] text-fg-muted">loading…</div>
            ) : tokens.length === 0 ? (
              <div className="text-[12.5px] text-fg-dim">
                No share links yet. Create one below.
              </div>
            ) : (
              <div className="space-y-2">
                {tokens.map((t) => {
                  const url =
                    typeof window !== "undefined"
                      ? `${window.location.origin}/shared/${t.token}`
                      : `/shared/${t.token}`;
                  return (
                    <div
                      key={t.token}
                      className="rounded-md border border-ink-600 bg-ink-900 p-2.5 space-y-2"
                    >
                      <div className="flex items-center gap-2">
                        <code className="flex-1 text-[11.5px] font-mono text-fg-dim truncate select-all">
                          {url}
                        </code>
                        <button
                          onClick={() => copy(url)}
                          className="text-[11px] font-mono px-2 py-0.5 rounded border border-ink-500 text-fg-muted hover:text-fg hover:border-ink-500 transition"
                        >
                          copy
                        </button>
                        <button
                          onClick={() => revoke(t.token)}
                          disabled={busy}
                          className="text-[11px] font-mono px-2 py-0.5 rounded border border-accent-red/40 text-accent-red hover:bg-accent-red/10 transition"
                        >
                          revoke
                        </button>
                      </div>
                      <div className="font-mono text-[10.5px] text-fg-faint">
                        created {new Date(t.created_at).toLocaleString()}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            <button
              onClick={createToken}
              disabled={busy}
              className="text-[12px] font-semibold px-3.5 py-1.5 rounded-md bg-accent-primary text-ink-900 hover:brightness-110 disabled:opacity-50 transition"
            >
              {busy ? "…" : tokens && tokens.length > 0 ? "Create another link" : "Create share link"}
            </button>

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
