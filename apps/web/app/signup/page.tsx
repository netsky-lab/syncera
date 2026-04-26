import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { AuthForm } from "@/components/auth-form";
import { listUsers } from "@/lib/users";
import { Card, CardContent } from "@/components/ui/card";
import { verifySession, COOKIE_NAME } from "@/lib/sessions";

export const dynamic = "force-dynamic";
export const metadata = { robots: { index: false, follow: false } };

export default async function SignupPage() {
  // Already signed in? No reason to be here.
  const jar = await cookies();
  const token = jar.get(COOKIE_NAME)?.value;
  if (verifySession(token)) redirect("/");

  const signupOpen = process.env.ALLOW_SIGNUP === "1";
  const isBootstrap = listUsers().length === 0;
  const closed = !signupOpen && !isBootstrap;

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm space-y-6">
        <header className="space-y-2 text-center">
          <div className="inline-flex items-center justify-center mx-auto w-12 h-12 rounded-xl bg-gradient-to-br from-primary to-primary/60 text-primary-foreground font-bold text-lg shadow-sm">
            S
          </div>
          <h1 className="text-2xl font-bold tracking-tight">
            {closed ? "Signup is closed" : "Create an account"}
          </h1>
          <p className="text-sm text-muted-foreground">
            {closed ? (
              <>Contact an admin to get invited.</>
            ) : isBootstrap ? (
              <>This will be the bootstrap admin account.</>
            ) : (
              <>Open signup — an admin enabled{" "}
                <code className="px-1 py-0.5 rounded bg-muted text-[11px] font-mono">ALLOW_SIGNUP=1</code>.
              </>
            )}
          </p>
        </header>
        {closed ? (
          <Card className="border-border/60">
            <CardContent className="py-6 px-6 space-y-4 text-center">
              <p className="text-sm text-muted-foreground">
                New accounts are currently invite-only. Ask an admin to create
                one for you from the Settings page.
              </p>
              <Link
                href="/login"
                className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline decoration-dotted"
              >
                Back to sign in →
              </Link>
            </CardContent>
          </Card>
        ) : (
          <AuthForm mode="signup" />
        )}
      </div>
    </div>
  );
}
