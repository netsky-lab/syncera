"use client";

import { useEffect, useState } from "react";

type User = { id: string; email: string; role: "admin" | "user" };

export function UserChip() {
  const [user, setUser] = useState<User | null>(null);

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

  return (
    <div className="border-t border-border/40 px-4 py-3 space-y-1.5 text-[11px]">
      <div className="flex items-center gap-2">
        <div className="w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center text-primary font-semibold shrink-0">
          {user.email.slice(0, 1).toUpperCase()}
        </div>
        <div className="flex-1 min-w-0">
          <div className="truncate font-medium text-foreground">{user.email}</div>
          <div className="text-muted-foreground">
            {user.role === "admin" ? "admin" : "member"}
          </div>
        </div>
      </div>
      <button
        onClick={logout}
        className="w-full text-left text-muted-foreground hover:text-foreground transition-colors"
      >
        Sign out
      </button>
    </div>
  );
}
