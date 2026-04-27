"use client";

import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { WebhookCard } from "./webhook-card";

type ApiKey = {
  id: string;
  name: string;
  prefix: string;
  created_at: number;
  last_used_at: number | null;
  revoked_at: number | null;
};

type User = {
  id: string;
  email: string;
  role: "admin" | "user";
  created_at: number;
  last_login_at: number | null;
};

function PasswordCard() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [msg, setMsg] = useState<
    | { kind: "ok"; text: string }
    | { kind: "err"; text: string }
    | null
  >(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setMsg(null);
    try {
      const r = await fetch("/api/auth/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ current, next }),
      });
      if (r.ok) {
        setMsg({ kind: "ok", text: "Password updated. Sign in again." });
        setCurrent("");
        setNext("");
        setTimeout(() => {
          window.location.href = "/login";
        }, 600);
      } else {
        const d = await r.json().catch(() => ({}));
        setMsg({ kind: "err", text: d.error ?? `Failed HTTP ${r.status}` });
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card className="border-border/60">
      <CardContent className="py-4 px-5 space-y-3">
        <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">
          Change password
        </div>
        <form onSubmit={handleSubmit} className="grid sm:grid-cols-2 gap-3">
          <label className="space-y-1.5">
            <div className="text-xs text-muted-foreground">Current</div>
            <input
              type="password"
              autoComplete="current-password"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
              className="w-full px-3 py-1.5 text-sm rounded-md border border-border bg-background focus:outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/20"
              required
            />
          </label>
          <label className="space-y-1.5">
            <div className="text-xs text-muted-foreground">
              New <span className="text-muted-foreground/70">(min 8)</span>
            </div>
            <input
              type="password"
              autoComplete="new-password"
              minLength={8}
              value={next}
              onChange={(e) => setNext(e.target.value)}
              className="w-full px-3 py-1.5 text-sm rounded-md border border-border bg-background focus:outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/20"
              required
            />
          </label>
          <div className="sm:col-span-2 flex items-center gap-3">
            <button
              type="submit"
              disabled={submitting || !current || next.length < 8}
              className="text-sm px-4 py-1.5 rounded-md bg-primary text-primary-foreground font-medium hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {submitting ? "Updating…" : "Update password"}
            </button>
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
        </form>
      </CardContent>
    </Card>
  );
}

function UsersSection() {
  const [users, setUsers] = useState<User[] | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"user" | "admin">("user");
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  async function load() {
    const r = await fetch("/api/admin/users");
    if (r.ok) {
      const d = await r.json();
      setUsers(d.users);
    } else if (r.status === 403) {
      setUsers([]); // not admin, hide section
    }
  }
  useEffect(() => {
    load();
  }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    setError(null);
    try {
      const r = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, role }),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        setError(d.error ?? `HTTP ${r.status}`);
        return;
      }
      setEmail("");
      setPassword("");
      setRole("user");
      await load();
    } finally {
      setCreating(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this user? They'll lose access immediately.")) return;
    await fetch(`/api/admin/users/${id}`, { method: "DELETE" });
    await load();
  }

  if (users === null) return null; // still loading
  if (users.length === 0) return null; // not admin or genuinely empty

  return (
    <section className="space-y-3">
      <div className="flex items-baseline justify-between">
        <h2 className="text-lg font-semibold tracking-tight">Users</h2>
        <span className="text-[11px] text-muted-foreground font-mono">
          {users.length}
        </span>
      </div>

      <Card className="border-border/60">
        <CardContent className="py-4 px-5 space-y-3">
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">
            Invite user
          </div>
          <form onSubmit={handleCreate} className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto_auto] gap-2 items-end">
            <label>
              <div className="text-xs text-muted-foreground mb-1">Email</div>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="w-full px-3 py-1.5 text-sm rounded-md border border-border bg-background focus:outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/20"
              />
            </label>
            <label>
              <div className="text-xs text-muted-foreground mb-1">
                Temp password
              </div>
              <input
                type="text"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={8}
                className="w-full px-3 py-1.5 text-sm rounded-md border border-border bg-background font-mono focus:outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/20"
              />
            </label>
            <label>
              <div className="text-xs text-muted-foreground mb-1">Role</div>
              <select
                value={role}
                onChange={(e) => setRole(e.target.value as any)}
                className="w-full sm:w-auto px-3 py-1.5 text-sm rounded-md border border-border bg-background focus:outline-none focus:border-primary/50"
              >
                <option value="user">user</option>
                <option value="admin">admin</option>
              </select>
            </label>
            <button
              type="submit"
              disabled={creating || !email || password.length < 8}
              className="w-full sm:w-auto text-sm px-4 py-1.5 rounded-md bg-primary text-primary-foreground font-medium hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {creating ? "…" : "Add"}
            </button>
          </form>
          {error && (
            <div className="text-[13px] text-red-400 p-2 rounded-md bg-red-500/5 border border-red-500/20">
              {error}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="space-y-2">
        {users.map((u) => (
          <Card key={u.id} className="border-border/60">
            <CardContent className="py-3 px-4 flex items-center gap-3 flex-wrap">
              <div className="flex-1 min-w-[200px] space-y-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[13px] font-medium">{u.email}</span>
                  <Badge
                    variant="outline"
                    className={`text-[10px] ${
                      u.role === "admin"
                        ? "bg-primary/10 text-primary border-primary/30"
                        : ""
                    }`}
                  >
                    {u.role}
                  </Badge>
                </div>
                <div className="text-[11px] text-muted-foreground flex items-center gap-3 flex-wrap">
                  <span>created {new Date(u.created_at).toLocaleDateString()}</span>
                  <span>
                    last login{" "}
                    {u.last_login_at
                      ? new Date(u.last_login_at).toLocaleString()
                      : "never"}
                  </span>
                </div>
              </div>
              <button
                onClick={() => handleDelete(u.id)}
                className="text-[11px] px-2.5 py-1 rounded border border-red-500/30 bg-red-500/5 text-red-400 hover:bg-red-500/15 hover:border-red-500/60 transition-colors"
              >
                Delete
              </button>
            </CardContent>
          </Card>
        ))}
      </div>
    </section>
  );
}

function timeFmt(ms: number | null): string {
  if (!ms) return "never";
  const d = new Date(ms);
  return d.toLocaleString();
}

export function SettingsContent() {
  const [role, setRole] = useState<"admin" | "user" | null>(null);
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
      const me = await fetch("/api/auth/me").then((r) => r.json()).catch(() => null);
      setRole(me?.user?.role ?? null);
      // Per-user endpoint: any signed-in user lists + mints their own keys.
      // Admin god-view of all keys still lives at /api/admin/keys (table in UsersSection).
      const kr = await fetch("/api/keys");
      if (!kr.ok) {
        setError(`Load failed: HTTP ${kr.status}`);
        return;
      }
      const data = await kr.json();
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
      const r = await fetch("/api/keys", {
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
      const r = await fetch(`/api/keys/${id}`, { method: "DELETE" });
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
      {/* Password change */}
      <PasswordCard />

      {/* Webhook (per-user) */}
      <WebhookCard />

      {/* Users (admin only) */}
      <UsersSection />

      {/* API keys — per-user. Any signed-in user can mint + revoke their
          own keys; admins also see everyone's keys in UsersSection above. */}
      <div className="pt-2 border-t border-border/40">
        <h2 className="text-lg font-semibold tracking-tight mb-1">API keys</h2>
        <p className="text-[13px] text-muted-foreground mb-3 max-w-2xl">
          Mint a scoped key to read your projects and trigger runs
          programmatically. Consumers authed with your key see only your
          research, not anyone else&apos;s. Raw value is shown once —
          store it immediately.
        </p>
      </div>

      <>
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
      </>
    </div>
  );
}
