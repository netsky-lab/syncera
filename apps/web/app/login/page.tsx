import { AuthForm } from "@/components/auth-form";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { verifySession, COOKIE_NAME } from "@/lib/sessions";

export const dynamic = "force-dynamic";
export const metadata = { robots: { index: false, follow: false } };

export default async function LoginPage() {
  // Already signed in? Skip straight to the dashboard.
  const jar = await cookies();
  const token = jar.get(COOKIE_NAME)?.value;
  if (verifySession(token)) redirect("/");

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm space-y-6">
        <header className="space-y-2 text-center">
          <div className="inline-flex items-center justify-center mx-auto w-12 h-12 rounded-xl bg-gradient-to-br from-primary to-primary/60 text-primary-foreground font-bold text-lg shadow-sm">
            R
          </div>
          <h1 className="text-2xl font-bold tracking-tight">
            Welcome back
          </h1>
          <p className="text-sm text-muted-foreground">
            Sign in to continue
          </p>
        </header>
        <AuthForm mode="login" />
      </div>
    </div>
  );
}
