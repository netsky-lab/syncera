import { AuthForm } from "@/components/auth-form";

export const dynamic = "force-dynamic";

export default function SignupPage() {
  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm space-y-6">
        <header className="space-y-2 text-center">
          <div className="inline-flex items-center justify-center mx-auto w-12 h-12 rounded-xl bg-gradient-to-br from-primary to-primary/60 text-primary-foreground font-bold text-lg shadow-sm">
            R
          </div>
          <h1 className="text-2xl font-bold tracking-tight">Create an account</h1>
          <p className="text-sm text-muted-foreground">
            The first account becomes the admin. Subsequent accounts need
            <code className="mx-1 px-1 py-0.5 rounded bg-muted text-[11px] font-mono">ALLOW_SIGNUP=1</code>
            or an invite.
          </p>
        </header>
        <AuthForm mode="signup" />
      </div>
    </div>
  );
}
