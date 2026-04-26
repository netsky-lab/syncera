import { SettingsContent } from "@/components/settings-content";
import { SignOutButton } from "@/components/sign-out-button";

export const dynamic = "force-dynamic";
export const metadata = { robots: { index: false, follow: false } };

export default function SettingsPage() {
  return (
    <div className="max-w-[1320px] mx-auto px-4 md:px-10 py-6 md:py-10 space-y-8">
      <header className="space-y-2 border-b border-border/50 pb-6">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] uppercase tracking-widest bg-primary/10 text-primary border border-primary/20 font-semibold">
              Account
            </span>
            <span className="text-[10px] text-muted-foreground font-mono">
              v0.3 · settings
            </span>
          </div>
          <SignOutButton />
        </div>
        <h1 className="text-2xl sm:text-3xl md:text-4xl font-bold tracking-tight">
          Settings
        </h1>
        <p className="text-[13px] sm:text-sm text-muted-foreground max-w-2xl leading-relaxed">
          Change your password and, if you&apos;re an admin, manage users
          and API keys. Raw key values are shown once on creation — save
          them then.
        </p>
      </header>
      <SettingsContent />
    </div>
  );
}
