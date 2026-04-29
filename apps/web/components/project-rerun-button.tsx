"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";

const RERUN_PHASES = [
  { value: "scout", label: "Full" },
  { value: "plan", label: "Plan+" },
  { value: "harvest", label: "Sources+" },
  { value: "evidence", label: "Evidence+" },
  { value: "verify", label: "Verify+" },
  { value: "analyze", label: "Analyze+" },
  { value: "synth", label: "Report" },
  { value: "playbook", label: "Playbook" },
];

export function ProjectRerunButton({ topic }: { topic: string }) {
  const [starting, setStarting] = useState(false);
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [phase, setPhase] = useState("evidence");
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
    const label = RERUN_PHASES.find((p) => p.value === phase)?.label ?? phase;
    if (!confirm(`Rerun from ${label} on the same topic?\n\n"${topic}"`)) return;
    setStarting(true);
    try {
      const r = await fetch("/api/runs/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic, rerun: true, rerun_from: phase }),
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
    <div className="inline-flex items-center rounded-md border overflow-hidden bg-background">
      <select
        value={phase}
        onChange={(e) => setPhase(e.target.value)}
        disabled={starting}
        className="h-8 max-w-[112px] bg-transparent px-2 text-xs outline-none border-r disabled:opacity-50"
        title="Choose the first phase to recompute"
      >
        {RERUN_PHASES.map((p) => (
          <option key={p.value} value={p.value}>
            {p.label}
          </option>
        ))}
      </select>
      <button
        onClick={handleRerun}
        disabled={starting}
        className="h-8 text-xs px-2.5 sm:px-3 hover:bg-accent transition-colors inline-flex items-center gap-1.5 disabled:opacity-50"
        title="Rerun the project from the selected phase"
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v6h6M20 20v-6h-6" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M20 10a8 8 0 00-14.93-2.37M4 14a8 8 0 0014.93 2.37" />
        </svg>
        {starting ? "Starting…" : "Rerun"}
      </button>
    </div>
  );
}
