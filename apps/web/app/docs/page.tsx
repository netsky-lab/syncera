import { ApiExplorer } from "@/components/api-explorer";

export const dynamic = "force-dynamic";

export default function DocsPage() {
  return (
    <div className="max-w-[1320px] mx-auto px-4 md:px-10 py-6 md:py-10 space-y-8">
      <header className="space-y-2 border-b border-border/50 pb-6">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] uppercase tracking-widest bg-primary/10 text-primary border border-primary/20 font-semibold">
            API
          </span>
          <span className="text-[10px] text-muted-foreground font-mono">
            v0.3 · REST / JSON
          </span>
        </div>
        <h1 className="text-2xl sm:text-3xl md:text-4xl font-bold tracking-tight">
          API reference
        </h1>
        <p className="text-[13px] sm:text-sm text-muted-foreground max-w-2xl leading-relaxed">
          Fetch research artifacts programmatically. Provide an API key
          either via <code className="px-1.5 py-0.5 rounded bg-muted text-[12px] font-mono">X-API-Key: …</code> or{" "}
          <code className="px-1.5 py-0.5 rounded bg-muted text-[12px] font-mono">Authorization: Bearer …</code>.
          Generate and revoke keys under{" "}
          <a href="/settings" className="text-primary/90 hover:text-primary underline decoration-dotted">
            Settings
          </a>
          . Full OpenAPI 3.1 spec available at{" "}
          <a
            href="/api/openapi.json"
            className="text-primary/90 hover:text-primary underline decoration-dotted font-mono text-[12px]"
          >
            /api/openapi.json
          </a>
          .
        </p>
      </header>
      <ApiExplorer />
    </div>
  );
}
