"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export function ProjectAdminActions({ slug }: { slug: string }) {
  const [isAdmin, setIsAdmin] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const router = useRouter();

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then((d) => setIsAdmin(d.user?.role === "admin"))
      .catch(() => {});
  }, []);

  if (!isAdmin) return null;

  async function handleDelete() {
    if (
      !confirm(
        `Delete project "${slug}"? This removes all artifacts (plan, facts, report, PDF) from disk and is irreversible.`
      )
    )
      return;
    setDeleting(true);
    try {
      const r = await fetch(`/api/projects/${slug}`, { method: "DELETE" });
      if (r.ok) {
        router.push("/");
      } else {
        const d = await r.json().catch(() => ({}));
        alert(`Delete failed: ${d.error ?? r.status}`);
        setDeleting(false);
      }
    } catch (e: any) {
      alert(`Delete failed: ${e.message ?? e}`);
      setDeleting(false);
    }
  }

  return (
    <button
      onClick={handleDelete}
      disabled={deleting}
      className="text-xs px-2.5 sm:px-3 py-1.5 rounded-md border border-red-500/30 bg-red-500/5 text-red-400 hover:bg-red-500/15 hover:border-red-500/60 transition-colors disabled:opacity-50 inline-flex items-center gap-1.5"
    >
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6h14z" />
      </svg>
      {deleting ? "Deleting…" : "Delete"}
    </button>
  );
}
