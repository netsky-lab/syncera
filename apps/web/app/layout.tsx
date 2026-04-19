import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import "./globals.css";
import "highlight.js/styles/github-dark.css";
import { UserChip } from "@/components/user-chip";
import { NavLink } from "@/components/nav-link";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Research Lab",
  description: "Hypothesis-driven research engine",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased dark`}
    >
      <head>
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, viewport-fit=cover"
        />
      </head>
      <body className="min-h-full bg-background text-foreground">
        {/* Mobile top bar — replaces sidebar on narrow screens */}
        <header className="md:hidden sticky top-0 z-30 flex items-center justify-between px-4 py-3 bg-background/90 backdrop-blur-sm border-b border-border/50">
          <Link href="/" className="flex items-center gap-2 group">
            <div className="w-7 h-7 rounded-md bg-gradient-to-br from-primary to-primary/60 flex items-center justify-center text-primary-foreground font-bold text-xs shadow-sm">
              R
            </div>
            <div className="font-semibold text-sm tracking-tight">Research Lab</div>
          </Link>
          <nav className="flex items-center gap-3 text-xs">
            <Link href="/" className="text-muted-foreground hover:text-foreground transition-colors">
              Projects
            </Link>
            <Link href="/docs" className="text-muted-foreground hover:text-foreground transition-colors">
              API
            </Link>
          </nav>
        </header>

        <div className="flex md:min-h-screen">
          {/* Desktop sidebar — hidden on mobile */}
          <aside className="hidden md:flex w-56 border-r bg-muted/30 flex-col shrink-0">
            <div className="px-5 py-5 border-b">
              <Link href="/" className="flex items-center gap-2 group">
                <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-primary to-primary/60 flex items-center justify-center text-primary-foreground font-bold text-sm shadow-sm">
                  R
                </div>
                <div>
                  <div className="font-semibold text-sm tracking-tight leading-none">
                    Research Lab
                  </div>
                  <div className="text-[10px] text-muted-foreground mt-1 leading-none">
                    question-first
                  </div>
                </div>
              </Link>
            </div>
            <nav className="flex-1 px-3 py-4 space-y-1">
              <NavLink
                href="/"
                exact
                className="flex items-center gap-2 px-3 py-2 rounded-md text-sm"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 4a1 1 0 011-1h5a1 1 0 011 1v5a1 1 0 01-1 1H4a1 1 0 01-1-1V4zM3 15a1 1 0 011-1h5a1 1 0 011 1v5a1 1 0 01-1 1H4a1 1 0 01-1-1v-5zM14 4a1 1 0 011-1h5a1 1 0 011 1v5a1 1 0 01-1 1h-5a1 1 0 01-1-1V4zM14 15a1 1 0 011-1h5a1 1 0 011 1v5a1 1 0 01-1 1h-5a1 1 0 01-1-1v-5z" />
                </svg>
                Projects
              </NavLink>
              <NavLink href="/docs" className="flex items-center gap-2 px-3 py-2 rounded-md text-sm">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M16 18l6-6-6-6M8 6l-6 6 6 6" />
                </svg>
                API
              </NavLink>
              <NavLink href="/settings" className="flex items-center gap-2 px-3 py-2 rounded-md text-sm">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 15a3 3 0 100-6 3 3 0 000 6z M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" />
                </svg>
                Settings
              </NavLink>
            </nav>
            <UserChip />
            <div className="px-5 py-3 border-t text-[10px] text-muted-foreground font-mono">
              v0.2.0 · engine
            </div>
          </aside>
          <main className="flex-1 min-w-0">{children}</main>
        </div>
      </body>
    </html>
  );
}
