"use client";

export function SignOutButton() {
  async function handle() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  }
  return (
    <button
      onClick={handle}
      className="text-xs px-3 py-1.5 rounded-md border border-border/60 bg-background hover:bg-accent transition-colors inline-flex items-center gap-1.5"
    >
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path strokeLinecap="round" strokeLinejoin="round" d="M15 17l5-5-5-5M20 12H9M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" />
      </svg>
      Sign out
    </button>
  );
}
