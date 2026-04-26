"use client";

import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";

export function WebhookCard() {
  const [url, setUrl] = useState("");
  const [hasSecret, setHasSecret] = useState(false);
  const [newSecret, setNewSecret] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  async function load() {
    try {
      const r = await fetch("/api/auth/webhook");
      if (!r.ok) return;
      const d = await r.json();
      setUrl(d.url ?? "");
      setHasSecret(Boolean(d.has_secret));
    } catch {}
  }

  useEffect(() => {
    load();
  }, []);

  async function save(rotate: boolean) {
    setSaving(true);
    setMsg(null);
    setNewSecret(null);
    try {
      const r = await fetch("/api/auth/webhook", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, rotate_secret: rotate }),
      });
      const d = await r.json();
      if (!r.ok) {
        setMsg({ kind: "err", text: d.error ?? `HTTP ${r.status}` });
        return;
      }
      if (d.secret) setNewSecret(d.secret);
      setHasSecret(Boolean(d.has_secret));
      setMsg({
        kind: "ok",
        text: rotate ? "Saved. Secret rotated — copy it now." : "Saved.",
      });
    } finally {
      setSaving(false);
    }
  }

  async function disable() {
    if (!confirm("Disable webhook? run.completed events will stop firing.")) return;
    setSaving(true);
    setMsg(null);
    setNewSecret(null);
    try {
      await fetch("/api/auth/webhook", { method: "DELETE" });
      setUrl("");
      setHasSecret(false);
      setMsg({ kind: "ok", text: "Disabled." });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="border-border/60">
      <CardContent className="py-4 px-5 space-y-3">
        <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">
          Webhook
        </div>
        <p className="text-[12px] text-muted-foreground leading-relaxed">
          POSTs <code className="font-mono">run.completed</code> /{" "}
          <code className="font-mono">run.failed</code> to the URL you set
          when a run you started finishes. Signature in{" "}
          <code className="font-mono">X-Signature-256: sha256=…</code>{" "}
          (HMAC-SHA256 over the raw JSON body). Retries 3× (1s / 5s / 30s)
          then logs to{" "}
          <code className="font-mono">data/webhook-failures.jsonl</code>.
        </p>
        <label className="block space-y-1.5">
          <div className="text-xs text-muted-foreground">
            Target URL
            {hasSecret && (
              <span className="ml-2 text-emerald-400 text-[10px] uppercase tracking-wider">
                · secret configured
              </span>
            )}
          </div>
          <input
            type="url"
            placeholder="https://your-consumer.example.com/hooks/research"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            className="w-full px-3 py-1.5 text-sm rounded-md border border-border bg-background font-mono focus:outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/20"
          />
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => save(false)}
            disabled={saving || !url}
            className="text-sm px-4 py-1.5 rounded-md bg-primary text-primary-foreground font-medium hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {saving ? "Saving…" : hasSecret ? "Update URL" : "Save & mint secret"}
          </button>
          {hasSecret && (
            <button
              onClick={async () => {
                setMsg(null);
                setSaving(true);
                try {
                  const r = await fetch("/api/auth/webhook/test", {
                    method: "POST",
                  });
                  const d = await r.json().catch(() => ({}));
                  if (r.ok) {
                    setMsg({
                      kind: "ok",
                      text: `Test ping fired — consumer returned HTTP ${d.status ?? "?"}`,
                    });
                  } else {
                    setMsg({
                      kind: "err",
                      text: `Test ping failed: ${d.error ?? r.status}`,
                    });
                  }
                } finally {
                  setSaving(false);
                }
              }}
              disabled={saving || !url}
              className="text-xs px-3 py-1.5 rounded-md border border-primary/30 bg-primary/5 text-primary hover:bg-primary/15 transition-colors disabled:opacity-50"
              title="Sends a synthetic run.test event to your configured URL"
            >
              Send test ping
            </button>
          )}
          {hasSecret && (
            <button
              onClick={() => save(true)}
              disabled={saving || !url}
              className="text-xs px-3 py-1.5 rounded-md border border-border hover:bg-accent transition-colors disabled:opacity-50"
            >
              Rotate secret
            </button>
          )}
          {hasSecret && (
            <button
              onClick={disable}
              disabled={saving}
              className="text-xs px-3 py-1.5 rounded-md border border-red-500/30 bg-red-500/5 text-red-400 hover:bg-red-500/15 hover:border-red-500/60 transition-colors disabled:opacity-50"
            >
              Disable
            </button>
          )}
          {msg && (
            <span
              className={`text-[13px] ${
                msg.kind === "ok" ? "text-emerald-400" : "text-red-400"
              }`}
            >
              {msg.text}
            </span>
          )}
        </div>
        {newSecret && (
          <div className="space-y-2 pt-2 border-t border-emerald-500/20">
            <div className="text-[10px] uppercase tracking-widest text-emerald-400 font-semibold">
              Secret — save now, shown once
            </div>
            <div className="p-2.5 rounded-md bg-background border border-border/60 font-mono text-[12px] break-all select-all">
              {newSecret}
            </div>
            <button
              onClick={() => navigator.clipboard?.writeText(newSecret)}
              className="text-[11px] px-2.5 py-1 rounded border border-primary/30 bg-primary/5 text-primary hover:bg-primary/15 transition-colors"
            >
              Copy to clipboard
            </button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
