"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

export function NavLink({
  href,
  children,
  className = "",
  exact = false,
}: {
  href: string;
  children: ReactNode;
  className?: string;
  exact?: boolean;
}) {
  const pathname = usePathname();
  const isActive = exact ? pathname === href : pathname.startsWith(href);
  return (
    <Link
      href={href}
      className={`${className} ${
        isActive
          ? "bg-primary/10 text-primary border-l-2 border-primary -ml-[2px]"
          : "hover:bg-accent"
      } transition-colors`}
    >
      {children}
    </Link>
  );
}
