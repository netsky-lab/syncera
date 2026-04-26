// "Forgot password?" page — user enters email, we send a reset link.
// Response is success regardless of whether the email exists (to not
// leak account existence via timing/error differences).

"use client";

import { useState } from "react";
import Link from "next/link";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const r = await fetch("/api/auth/password-reset-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const d = await r.json();
      if (!r.ok) {
        setError(d.error ?? `HTTP ${r.status}`);
        setBusy(false);
        return;
      }
      setDone(true);
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4 py-12 bg-ink-900">
        <div className="w-full max-w-sm space-y-4 text-center">
          <div className="inline-flex items-center justify-center mx-auto w-12 h-12 rounded-xl bg-accent-sage/20 text-accent-sage text-2xl">
            ✓
          </div>
          <h1 className="text-xl font-semibold">Check your inbox</h1>
          <p className="text-[13px] text-fg-muted">
            If <strong className="text-fg">{email}</strong> is registered,
            we just sent a password reset link. It expires in 1 hour.
          </p>
          <Link
            href="/login"
            className="inline-block text-[12px] text-accent-primary hover:brightness-110"
          >
            Back to sign in →
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-12 bg-ink-900">
      <div className="w-full max-w-sm space-y-6">
        <header className="space-y-2 text-center">
          <div className="inline-flex items-center justify-center mx-auto w-12 h-12 rounded-xl bg-gradient-to-br from-accent-primary to-accent-rust text-ink-900 font-bold text-lg">
            R
          </div>
          <h1 className="text-2xl font-bold tracking-tight">Reset password</h1>
          <p className="text-sm text-fg-muted">
            Enter the email you signed up with. We&apos;ll send a link to
            set a new password.
          </p>
        </header>
        <form
          onSubmit={submit}
          className="space-y-3 rounded-xl border border-ink-600 bg-ink-800 p-5"
        >
          <label className="block space-y-1">
            <div className="text-[11px] text-fg-muted">Email</div>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={busy}
              autoFocus
              required
              className="w-full h-9 px-3 text-[13px] rounded-md bg-ink-900 border border-ink-500 text-fg focus:outline-none focus:border-accent-primary/60"
            />
          </label>
          <button
            type="submit"
            disabled={busy || !email}
            className="w-full h-10 rounded-lg bg-accent-primary text-ink-900 text-[13px] font-semibold hover:brightness-110 disabled:opacity-50 transition"
          >
            {busy ? "Sending…" : "Send reset link"}
          </button>
          {error && (
            <div className="text-[12px] text-accent-red bg-accent-red/5 border border-accent-red/20 rounded-md px-2 py-1.5">
              {error}
            </div>
          )}
          <Link
            href="/login"
            className="block text-center text-[12px] text-fg-muted hover:text-fg"
          >
            Back to sign in
          </Link>
        </form>
      </div>
    </div>
  );
}
