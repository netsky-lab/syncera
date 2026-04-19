"use client";

import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

type ApiKey = {
  id: string;
  name: string;
  prefix: string;
  created_at: number;
  last_used_at: number | null;
  revoked_at: number | null;
};

function timeFmt(ms: number | null): string {
  if (!ms) return "never";
  const d = new Date(ms);
  return d.toLocaleString();
}

export function SettingsContent() {
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [newlyCreated, setNewlyCreated] = useState<{
    name: string;
    key: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setError(null);
    try {
      const r = await fetch("/api/admin/keys");
      if (!r.ok) {
        setError(
          r.status === 401
            ? "Unauthorized — log in with Basic Auth credentials"
            : `Load failed: HTTP ${r.status}`
        );
        return;
      }
      const data = await r.json();
      setKeys(data.keys ?? []);
    } catch (e: any) {
      setError(String(e?.message ?? e));
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function handleCreate() {
    if (creating) return;
    setCreating(true);
    setError(null);
    try {
      const r = await fetch("/api/admin/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!r.ok) {
        setError(`Create failed: HTTP ${r.status}`);
        return;
      }
      const data = await r.json();
      setNewlyCreated({ name: data.name, key: data.key });
      setName("");
      await load();
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally {
      setCreating(false);
    }
  }

  async function handleRevoke(id: string) {
    if (!confirm("Revoke this key? Consumers using it will be cut off.")) return;
    try {
      const r = await fetch(`/api/admin/keys/${id}`, { method: "DELETE" });
      if (!r.ok) setError(`Revoke failed: HTTP ${r.status}`);
      await load();
    } catch (e: any) {
      setError(String(e?.message ?? e));
    }
  }

  const active = keys.filter((k) => !k.revoked_at);
  const revoked = keys.filter((k) => k.revoked_at);

  return (
    <div className="space-y-6">
      {/* Create form */}
      <Card className="border-border/60">
        <CardContent className="py-4 px-5 space-y-3">
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">
            Generate a new API key
          </div>
          <div className="flex gap-2 items-end flex-wrap">
            <label className="flex-1 min-w-[200px]">
              <div className="text-xs text-muted-foreground mb-1">Label</div>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. validator-app"
                className="w-full px-3 py-1.5 text-sm rounded-md border border-border bg-background placeholder:text-muted-foreground focus:outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/20"
              />
            </label>
            <button
              onClick={handleCreate}
              disabled={creating || !name.trim()}
              className="text-sm px-4 py-1.5 rounded-md bg-primary text-primary-foreground font-medium hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {creating ? "Creating…" : "Generate key"}
            </button>
          </div>
        </CardContent>
      </Card>

      {/* Newly-created key reveal */}
      {newlyCreated && (
        <Card className="border-emerald-500/40 bg-emerald-500/5">
          <CardContent className="py-4 px-5 space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-[10px] uppercase tracking-widest text-emerald-400 font-semibold mb-1">
                  Key created — save it now
                </div>
                <div className="text-[13px] text-foreground">
                  <code className="font-mono">{newlyCreated.name}</code>
                </div>
              </div>
              <button
                onClick={() => setNewlyCreated(null)}
                className="text-muted-foreground hover:text-foreground transition-colors text-lg leading-none"
                aria-label="Dismiss"
              >
                ×
              </button>
            </div>
            <div className="p-3 rounded-md bg-background border border-border/60 font-mono text-[13px] break-all select-all">
              {newlyCreated.key}
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  navigator.clipboard?.writeText(newlyCreated.key);
                }}
                className="text-[11px] px-2.5 py-1 rounded border border-primary/30 bg-primary/5 text-primary hover:bg-primary/15 transition-colors"
              >
                Copy to clipboard
              </button>
              <span className="text-[11px] text-amber-400">
                You won't see this value again.
              </span>
            </div>
          </CardContent>
        </Card>
      )}

      {error && (
        <Card className="border-red-500/40 bg-red-500/5">
          <CardContent className="py-3 px-4 text-[13px] text-red-300">
            {error}
          </CardContent>
        </Card>
      )}

      {/* Active keys */}
      <section className="space-y-3">
        <div className="flex items-baseline justify-between">
          <h2 className="text-lg font-semibold tracking-tight">
            Active keys
          </h2>
          <span className="text-[11px] text-muted-foreground font-mono">
            {active.length}
          </span>
        </div>
        {active.length === 0 ? (
          <Card className="border-dashed">
            <CardContent className="py-10 text-center text-sm text-muted-foreground">
              No keys yet — generate one above.
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {active.map((k) => (
              <Card key={k.id} className="border-border/60">
                <CardContent className="py-3 px-4 flex items-center gap-3 flex-wrap">
                  <div className="flex-1 min-w-[200px] space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="text-[13px] font-medium">{k.name}</span>
                      <code className="font-mono text-[11px] text-muted-foreground">
                        {k.prefix}…
                      </code>
                      {k.id === "seed" && (
                        <Badge variant="outline" className="text-[9px]">
                          env
                        </Badge>
                      )}
                    </div>
                    <div className="text-[11px] text-muted-foreground flex items-center gap-3 flex-wrap">
                      <span>created {timeFmt(k.created_at)}</span>
                      <span>last used {timeFmt(k.last_used_at)}</span>
                    </div>
                  </div>
                  {k.id !== "seed" && (
                    <button
                      onClick={() => handleRevoke(k.id)}
                      className="text-[11px] px-2.5 py-1 rounded border border-red-500/30 bg-red-500/5 text-red-400 hover:bg-red-500/15 hover:border-red-500/60 transition-colors"
                    >
                      Revoke
                    </button>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>

      {/* Revoked keys */}
      {revoked.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-baseline justify-between">
            <h2 className="text-lg font-semibold tracking-tight text-muted-foreground">
              Revoked
            </h2>
            <span className="text-[11px] text-muted-foreground font-mono">
              {revoked.length}
            </span>
          </div>
          <div className="space-y-2">
            {revoked.map((k) => (
              <Card key={k.id} className="border-border/40 opacity-60">
                <CardContent className="py-3 px-4 flex items-center gap-3">
                  <div className="flex-1 min-w-0 space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="text-[13px] line-through decoration-zinc-500/60">
                        {k.name}
                      </span>
                      <code className="font-mono text-[11px] text-muted-foreground">
                        {k.prefix}…
                      </code>
                    </div>
                    <div className="text-[11px] text-muted-foreground">
                      revoked {timeFmt(k.revoked_at)}
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
