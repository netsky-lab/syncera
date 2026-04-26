// Landing page for password-reset email links. Reads `?token=` from
// query, POSTs to /api/auth/password-reset-confirm with the new
// password, then redirects to dashboard on success.

"use client";

import { useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";

export default function ResetPasswordPage() {
  const sp = useSearchParams();
  const router = useRouter();
  const token = sp.get("token") ?? "";
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError("Password must be at least 8 characters");
      return;
    }
    if (password !== confirm) {
      setError("Passwords don't match");
      return;
    }
    if (!token) {
      setError("Missing reset token — open the link from your email");
      return;
    }
    setBusy(true);
    try {
      const r = await fetch("/api/auth/password-reset-confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, new_password: password }),
      });
      const d = await r.json();
      if (!r.ok) {
        setError(d.error ?? `HTTP ${r.status}`);
        setBusy(false);
        return;
      }
      window.location.href = "/";
    } catch (e: any) {
      setError(String(e?.message ?? e));
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-12 bg-ink-900">
      <div className="w-full max-w-sm space-y-6">
        <header className="space-y-2 text-center">
          <div className="inline-flex items-center justify-center mx-auto w-12 h-12 rounded-xl bg-gradient-to-br from-accent-primary to-accent-rust text-ink-900 font-bold text-lg">
            R
          </div>
          <h1 className="text-2xl font-bold tracking-tight">Set a new password</h1>
          <p className="text-sm text-fg-muted">
            Enter a new password to finish the reset.
          </p>
        </header>

        <form
          onSubmit={submit}
          className="space-y-3 rounded-xl border border-ink-600 bg-ink-800 p-5"
        >
          <label className="block space-y-1">
            <div className="text-[11px] text-fg-muted">New password</div>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={busy}
              autoFocus
              placeholder="at least 8 characters"
              className="w-full h-9 px-3 text-[13px] rounded-md bg-ink-900 border border-ink-500 text-fg placeholder:text-fg-muted focus:outline-none focus:border-accent-primary/60"
            />
          </label>
          <label className="block space-y-1">
            <div className="text-[11px] text-fg-muted">Confirm password</div>
            <input
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              disabled={busy}
              className="w-full h-9 px-3 text-[13px] rounded-md bg-ink-900 border border-ink-500 text-fg placeholder:text-fg-muted focus:outline-none focus:border-accent-primary/60"
            />
          </label>
          <button
            type="submit"
            disabled={busy || !password || !confirm}
            className="w-full h-10 rounded-lg bg-accent-primary text-ink-900 text-[13px] font-semibold hover:brightness-110 disabled:opacity-50 transition"
          >
            {busy ? "Updating…" : "Update password"}
          </button>
          {error && (
            <div className="text-[12px] text-accent-red bg-accent-red/5 border border-accent-red/20 rounded-md px-2 py-1.5">
              {error}
            </div>
          )}
        </form>
      </div>
    </div>
  );
}
