"use client";

import Link from "next/link";
import { useState } from "react";
import { NavLink } from "./nav-link";
import { AdminLink } from "./admin-link";
import { UserChip } from "./user-chip";

// App shell ported from the dashboard prototype:
// - Fixed 240px sidebar on md+, off-canvas + backdrop on mobile
// - Warm ink-900 surface, terracotta logo gradient
// - Inter UI typography inherited from root layout
export function AppShell({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const closeMenu = () => setOpen(false);

  return (
    <div className="flex min-h-screen bg-ink-900 text-fg">
      {/* Mobile backdrop */}
      {open && (
        <div
          onClick={closeMenu}
          className="md:hidden fixed inset-0 bg-black/60 z-30"
        />
      )}

      {/* Sidebar — off-canvas on mobile, fixed on md+ */}
      <aside
        className={`fixed md:sticky md:top-0 inset-y-0 left-0 z-40 w-60 bg-ink-900 border-r border-fg/[0.06] flex flex-col shrink-0 h-screen transition-transform duration-200 ${
          open ? "translate-x-0" : "-translate-x-full"
        } md:translate-x-0`}
      >
        <Link
          href="/"
          onClick={closeMenu}
          className="px-5 pt-5 pb-8 flex items-center gap-2.5 group"
        >
          <div className="h-7 w-7 rounded-md bg-gradient-to-br from-accent-primary to-accent-rust grid place-items-center shrink-0">
            <span className="text-[14px] font-bold leading-none text-ink-900">
              S
            </span>
          </div>
          <div>
            <div className="text-[13px] font-semibold leading-tight">
              Syncera
            </div>
            <div className="text-[11px] text-fg-muted">question-first</div>
          </div>
        </Link>

        <nav
          className="px-3 flex flex-col gap-0.5 text-[13px]"
          onClick={closeMenu}
        >
          <NavLink
            href="/"
            exact
            className="flex items-center gap-2.5 px-2.5 py-1.5 rounded-md"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path
                d="M2 4h10M2 7h10M2 10h10"
                stroke="currentColor"
                strokeWidth="1.3"
                strokeLinecap="round"
              />
            </svg>
            Projects
          </NavLink>
          <NavLink
            href="/docs"
            className="flex items-center gap-2.5 px-2.5 py-1.5 rounded-md"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path
                d="M4 3v8M10 3v8M2 5h10M2 9h10"
                stroke="currentColor"
                strokeWidth="1.3"
                strokeLinecap="round"
              />
            </svg>
            API
          </NavLink>
          <NavLink
            href="/settings"
            className="flex items-center gap-2.5 px-2.5 py-1.5 rounded-md"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <circle
                cx="7"
                cy="7"
                r="2"
                stroke="currentColor"
                strokeWidth="1.3"
              />
              <path
                d="M7 2v1.5M7 10.5V12M12 7h-1.5M3.5 7H2M10.5 3.5l-1 1M4.5 9.5l-1 1M10.5 10.5l-1-1M4.5 4.5l-1-1"
                stroke="currentColor"
                strokeWidth="1.3"
                strokeLinecap="round"
              />
            </svg>
            Settings
          </NavLink>
          <AdminLink />
        </nav>

        <div className="mt-auto">
          <UserChip />
        </div>
      </aside>

      <main className="flex-1 min-w-0">
        {/* Mobile top bar */}
        <header className="md:hidden h-14 border-b border-fg/[0.06] flex items-center justify-between px-4 sticky top-0 bg-ink-900 z-20">
          <Link href="/" className="flex items-center gap-2.5">
            <div className="h-7 w-7 rounded-md bg-gradient-to-br from-accent-primary to-accent-rust grid place-items-center">
              <span className="text-[14px] font-bold leading-none text-ink-900">
                S
              </span>
            </div>
            <div className="text-[13px] font-semibold">Syncera</div>
          </Link>
          <button
            onClick={() => setOpen(true)}
            className="p-2 -mr-2 text-fg-dim"
            aria-label="Open menu"
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <path
                d="M3 6h14M3 10h14M3 14h14"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </header>

        {children}
      </main>
    </div>
  );
}
