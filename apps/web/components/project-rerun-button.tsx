"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";

export function ProjectRerunButton({ topic }: { topic: string }) {
  const [starting, setStarting] = useState(false);
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const router = useRouter();

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then((d) => setSignedIn(Boolean(d.user)))
      .catch(() => setSignedIn(false));
  }, []);

  // Hide the button for anonymous visitors — clicking would 401.
  if (signedIn === false) return null;

  async function handleRerun() {
    if (!confirm(`Start a fresh run on the same topic?\n\n"${topic}"`)) return;
    setStarting(true);
    try {
      const r = await fetch("/api/runs/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic, rerun: true }),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        alert(`Rerun failed: ${d.error ?? r.status}`);
        setStarting(false);
        return;
      }
      const { slug } = await r.json();
      router.push(`/projects/${slug}`);
    } catch (e: any) {
      alert(`Rerun failed: ${e.message ?? e}`);
      setStarting(false);
    }
  }

  return (
    <button
      onClick={handleRerun}
      disabled={starting}
      className="text-xs px-2.5 sm:px-3 py-1.5 rounded-md border hover:bg-accent transition-colors inline-flex items-center gap-1.5 disabled:opacity-50"
    >
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v6h6M20 20v-6h-6" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M20 10a8 8 0 00-14.93-2.37M4 14a8 8 0 0014.93 2.37" />
      </svg>
      {starting ? "Starting…" : "Rerun"}
    </button>
  );
}
