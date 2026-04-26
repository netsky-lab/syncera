"use client";

import { useEffect, useState } from "react";
import { NavLink } from "./nav-link";

export function AdminLink() {
  const [isAdmin, setIsAdmin] = useState(false);
  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then((d) => setIsAdmin(d.user?.role === "admin"))
      .catch(() => {});
  }, []);
  if (!isAdmin) return null;
  return (
    <NavLink
      href="/admin"
      className="flex items-center gap-2 px-3 py-2 rounded-md text-sm"
    >
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M9 19v-6a2 2 0 012-2h2a2 2 0 012 2v6m-6 0h6m-6 0H3m12 0h6M5 9V5a2 2 0 012-2h10a2 2 0 012 2v4M3 9h18"
        />
      </svg>
      Admin
    </NavLink>
  );
}
