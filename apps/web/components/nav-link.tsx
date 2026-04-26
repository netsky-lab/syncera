"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

export function NavLink({
  href,
  children,
  className = "",
  exact = false,
  variant = "sidebar",
}: {
  href: string;
  children: ReactNode;
  className?: string;
  exact?: boolean;
  variant?: "sidebar" | "pill";
}) {
  const pathname = usePathname();
  const isActive = exact ? pathname === href : pathname.startsWith(href);
  const activeCls =
    variant === "pill"
      ? "bg-ink-700 text-fg"
      : "bg-ink-800 text-fg shadow-[inset_2px_0_0_var(--accent-primary)]";
  const inactiveCls =
    variant === "pill"
      ? "text-fg-dim hover:text-fg hover:bg-ink-700/60"
      : "text-fg-dim hover:text-fg hover:bg-ink-800";
  return (
    <Link
      href={href}
      aria-current={isActive ? "page" : undefined}
      className={`${className} ${isActive ? activeCls : inactiveCls} transition-[color,background-color,box-shadow]`}
    >
      {children}
    </Link>
  );
}
