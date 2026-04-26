import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";

export default function NotFound() {
  return (
    <div className="min-h-[70vh] flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-md space-y-6">
        <header className="space-y-2 text-center">
          <div className="inline-flex items-center justify-center mx-auto w-12 h-12 rounded-xl bg-muted text-muted-foreground font-mono font-bold text-sm">
            404
          </div>
          <h1 className="text-2xl font-bold tracking-tight">Not found</h1>
          <p className="text-sm text-muted-foreground">
            This research project, page, or artifact doesn&apos;t exist — it
            may have been deleted, never created, or the URL is mistyped.
          </p>
        </header>
        <Card className="border-border/60">
          <CardContent className="py-5 px-6 flex items-center justify-between gap-3 flex-wrap">
            <Link
              href="/"
              className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline decoration-dotted"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 18l-6-6 6-6" />
              </svg>
              Back to projects
            </Link>
            <Link
              href="/docs"
              className="text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              API reference →
            </Link>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
