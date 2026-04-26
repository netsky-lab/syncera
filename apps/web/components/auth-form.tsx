"use client";

import { useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";

export function AuthForm({ mode }: { mode: "login" | "signup" }) {
  const searchParams = useSearchParams();
  const nextParam = searchParams.get("next");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (loading) return;
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`/api/auth/${mode}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      if (r.ok) {
        // Hard redirect so server-side cookie takes effect immediately.
        // Only honor same-origin ?next paths to prevent open-redirect.
        const dest =
          nextParam && nextParam.startsWith("/") && !nextParam.startsWith("//")
            ? nextParam
            : "/";
        window.location.href = dest;
        return;
      }
      const data = await r.json().catch(() => ({}));
      setError(data.error ?? `Failed: HTTP ${r.status}`);
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card className="border-border/60">
      <CardContent className="py-6 px-6 space-y-4">
        <form onSubmit={handleSubmit} className="space-y-3">
          <label className="block space-y-1.5">
            <span className="text-xs text-muted-foreground">Email</span>
            <input
              type="email"
              autoComplete={mode === "login" ? "email" : "username"}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="w-full px-3 py-2 text-sm rounded-md border border-border bg-background placeholder:text-muted-foreground focus:outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/20"
              placeholder="you@example.com"
            />
          </label>
          <label className="block space-y-1.5">
            <span className="text-xs text-muted-foreground">
              Password{" "}
              {mode === "signup" && (
                <span className="text-muted-foreground/70">(min 8 chars)</span>
              )}
            </span>
            <input
              type="password"
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={mode === "signup" ? 8 : undefined}
              className="w-full px-3 py-2 text-sm rounded-md border border-border bg-background placeholder:text-muted-foreground focus:outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/20"
              placeholder="••••••••"
            />
          </label>
          {error && (
            <div className="text-[13px] text-red-400 p-2.5 rounded-md bg-red-500/5 border border-red-500/20">
              {error}
            </div>
          )}
          <button
            type="submit"
            disabled={loading || !email || !password}
            className="w-full text-sm px-4 py-2 rounded-md bg-primary text-primary-foreground font-medium hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {loading
              ? mode === "login"
                ? "Signing in…"
                : "Creating…"
              : mode === "login"
                ? "Sign in"
                : "Create account"}
          </button>
        </form>
        <div className="text-center text-[12px] text-muted-foreground pt-2 border-t border-border/40 space-y-2">
          {mode === "login" ? (
            <>
              <div>
                Need an account?{" "}
                <Link
                  href="/signup"
                  className="text-primary/80 hover:text-primary underline decoration-dotted"
                >
                  Sign up
                </Link>
              </div>
              <div>
                <Link
                  href="/forgot-password"
                  className="text-muted-foreground hover:text-foreground underline decoration-dotted"
                >
                  Forgot password?
                </Link>
              </div>
            </>
          ) : (
            <>
              Already registered?{" "}
              <Link
                href="/login"
                className="text-primary/80 hover:text-primary underline decoration-dotted"
              >
                Sign in
              </Link>
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
