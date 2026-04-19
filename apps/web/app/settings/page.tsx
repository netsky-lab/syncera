import { SettingsContent } from "@/components/settings-content";

export const dynamic = "force-dynamic";

export default function SettingsPage() {
  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 md:px-8 py-6 md:py-10 space-y-8">
      <header className="space-y-2 border-b border-border/50 pb-6">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] uppercase tracking-widest bg-primary/10 text-primary border border-primary/20 font-semibold">
            Admin
          </span>
          <span className="text-[10px] text-muted-foreground font-mono">
            v0.2 · settings
          </span>
        </div>
        <h1 className="text-2xl sm:text-3xl md:text-4xl font-bold tracking-tight">
          Settings
        </h1>
        <p className="text-[13px] sm:text-sm text-muted-foreground max-w-2xl leading-relaxed">
          Generate, list, and revoke API keys for external consumers.
          Keys are stored hashed; the raw value is shown exactly once on
          creation — save it then.
        </p>
      </header>
      <SettingsContent />
    </div>
  );
}
