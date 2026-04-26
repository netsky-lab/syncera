"use client";

import { useEffect, useState } from "react";

type User = { id: string; email: string; role: "admin" | "user" };

export function UserChip() {
  const [user, setUser] = useState<User | null>(null);
  const [hover, setHover] = useState(false);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then((d) => setUser(d.user ?? null))
      .catch(() => {});
  }, []);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  }

  if (!user) return null;

  // Handle / domain split from email
  const [handle, domain] = user.email.split("@");
  const initials = (handle ?? "u").slice(0, 2).toUpperCase();

  return (
    <div
      className="px-3 pb-4"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <div className="flex items-center gap-2.5 px-2 py-2 rounded-md hover:bg-ink-700 transition cursor-default group">
        <div className="h-7 w-7 rounded-full bg-ink-500 grid place-items-center text-[11px] font-semibold text-fg-dim shrink-0">
          {initials}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[12px] truncate text-fg">{handle}</div>
          <div className="text-[11px] text-fg-muted truncate">
            {domain ?? user.role}
          </div>
        </div>
        <button
          onClick={logout}
          className={`text-fg-muted hover:text-accent-red transition ${hover ? "opacity-100" : "opacity-0"}`}
          aria-label="Sign out"
          title="Sign out"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path
              d="M5.5 2.5h-3v9h3M8 4.5 10.5 7 8 9.5M10.5 7H5"
              stroke="currentColor"
              strokeWidth="1.3"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </div>
    </div>
  );
}
