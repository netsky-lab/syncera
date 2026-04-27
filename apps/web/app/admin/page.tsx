import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import Link from "next/link";
import { verifySessionUser, COOKIE_NAME } from "@/lib/sessions";
import { findUserById, listUsers } from "@/lib/users";
import { listProjects, getOwner } from "@/lib/projects";
import { listKeys } from "@/lib/keys";
import { listRuns } from "@/lib/runner";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export const dynamic = "force-dynamic";
export const metadata = { robots: { index: false, follow: false } };

export default async function AdminPage() {
  const jar = await cookies();
  const viewerUid = verifySessionUser(jar.get(COOKIE_NAME)?.value)?.uid ?? null;
  const user = viewerUid ? findUserById(viewerUid) : null;
  if (!user) redirect("/login?next=/admin");
  if (user.role !== "admin") redirect("/");

  const users = listUsers();
  const projects = listProjects(user.id);
  const keys = listKeys();
  const runs = listRuns(user.id, true);

  const activeRuns = runs.filter((r) => r.status === "running");
  const failedRuns = runs.filter((r) => r.status === "failed");
  const completedRuns = runs.filter((r) => r.status === "completed");

  // Projects per owner
  const byOwner = new Map<string, number>();
  for (const p of projects) {
    const key = p.owner_uid ?? "unowned";
    byOwner.set(key, (byOwner.get(key) ?? 0) + 1);
  }

  return (
    <div className="max-w-[1320px] mx-auto px-4 md:px-10 py-6 md:py-10 space-y-8">
      <header className="space-y-2 border-b border-border/50 pb-6">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] uppercase tracking-widest bg-red-500/10 text-red-300 border border-red-500/20 font-semibold">
            Admin
          </span>
          <span className="text-[10px] text-muted-foreground font-mono">
            observability
          </span>
        </div>
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">
          Instance overview
        </h1>
      </header>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Users" value={users.length} accent="sky" />
        <Stat label="Projects" value={projects.length} accent="violet" />
        <Stat
          label="Runs active"
          value={activeRuns.length}
          accent="amber"
          hint={`${completedRuns.length} done · ${failedRuns.length} failed`}
        />
        <Stat label="API keys" value={keys.length} accent="emerald" />
      </div>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold tracking-tight">Users</h2>
        <Card className="border-border/60">
          <CardContent className="p-0 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                  <th className="py-2 px-3">Email</th>
                  <th className="py-2 px-3">Role</th>
                  <th className="py-2 px-3">Projects</th>
                  <th className="py-2 px-3">Created</th>
                  <th className="py-2 px-3">Last login</th>
                  <th className="py-2 px-3">Webhook</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => {
                  const hookOn = Boolean((u as any).webhook_url);
                  return (
                    <tr key={u.id} className="border-b border-border/40 last:border-0">
                      <td className="py-2 px-3 font-mono text-[12px]">{u.email}</td>
                      <td className="py-2 px-3">
                        <Badge variant="outline" className="text-[10px]">
                          {u.role}
                        </Badge>
                      </td>
                      <td className="py-2 px-3 tabular-nums">
                        {byOwner.get(u.id) ?? 0}
                      </td>
                      <td className="py-2 px-3 text-[11px] text-muted-foreground tabular-nums">
                        {new Date(u.created_at).toISOString().slice(0, 10)}
                      </td>
                      <td className="py-2 px-3 text-[11px] text-muted-foreground tabular-nums">
                        {u.last_login_at
                          ? new Date(u.last_login_at).toISOString().slice(0, 16).replace("T", " ")
                          : "never"}
                      </td>
                      <td className="py-2 px-3 text-[11px]">
                        {hookOn ? (
                          <span className="text-emerald-400">✓ set</span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </CardContent>
        </Card>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold tracking-tight">Runs</h2>
        {runs.length === 0 ? (
          <Card className="border-dashed">
            <CardContent className="py-8 text-center text-sm text-muted-foreground">
              No runs recorded in this process.
            </CardContent>
          </Card>
        ) : (
          <Card className="border-border/60">
            <CardContent className="p-0 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                    <th className="py-2 px-3">Topic</th>
                    <th className="py-2 px-3">Status</th>
                    <th className="py-2 px-3">Phase</th>
                    <th className="py-2 px-3">Owner</th>
                    <th className="py-2 px-3">Started</th>
                  </tr>
                </thead>
                <tbody>
                  {runs.slice(0, 40).map((r) => {
                    const ownerEmail =
                      users.find((u) => u.id === r.owner_uid)?.email ?? "—";
                    return (
                      <tr
                        key={r.id}
                        className="border-b border-border/40 last:border-0"
                      >
                        <td className="py-2 px-3 text-[12px] max-w-[240px] truncate">
                          <Link
                            href={`/projects/${r.slug}`}
                            className="hover:text-primary transition-colors"
                          >
                            {r.topic}
                          </Link>
                        </td>
                        <td className="py-2 px-3">
                          <Badge
                            variant="outline"
                            className={`text-[10px] ${
                              r.status === "running"
                                ? "bg-primary/10 text-primary border-primary/30"
                                : r.status === "completed"
                                  ? "bg-emerald-500/10 text-emerald-300 border-emerald-500/30"
                                  : "bg-red-500/10 text-red-300 border-red-500/30"
                            }`}
                          >
                            {r.status}
                          </Badge>
                        </td>
                        <td className="py-2 px-3 text-[11px] font-mono">
                          {r.phase ?? "—"}
                        </td>
                        <td className="py-2 px-3 text-[11px] text-muted-foreground">
                          {ownerEmail}
                        </td>
                        <td className="py-2 px-3 text-[11px] text-muted-foreground tabular-nums">
                          {new Date(r.startedAt).toISOString().slice(0, 16).replace("T", " ")}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </CardContent>
          </Card>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold tracking-tight">API keys</h2>
        {keys.length === 0 ? (
          <Card className="border-dashed">
            <CardContent className="py-8 text-center text-sm text-muted-foreground">
              No API keys minted. Generate one from Settings.
            </CardContent>
          </Card>
        ) : (
          <Card className="border-border/60">
            <CardContent className="p-0 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                    <th className="py-2 px-3">Name</th>
                    <th className="py-2 px-3">Prefix</th>
                    <th className="py-2 px-3">Owner</th>
                    <th className="py-2 px-3">Last used</th>
                    <th className="py-2 px-3">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {keys.map((k) => {
                    const ownerEmail =
                      users.find((u) => u.id === (k as any).owner_uid)?.email ?? "—";
                    return (
                      <tr
                        key={k.id}
                        className={`border-b border-border/40 last:border-0 ${k.revoked_at ? "opacity-50" : ""}`}
                      >
                        <td className="py-2 px-3 text-[12px]">{k.name}</td>
                        <td className="py-2 px-3 text-[11px] font-mono text-muted-foreground">
                          {k.prefix}…
                        </td>
                        <td className="py-2 px-3 text-[11px] text-muted-foreground">
                          {ownerEmail}
                        </td>
                        <td className="py-2 px-3 text-[11px] text-muted-foreground tabular-nums">
                          {k.last_used_at
                            ? new Date(k.last_used_at).toISOString().slice(0, 16).replace("T", " ")
                            : "never"}
                        </td>
                        <td className="py-2 px-3">
                          {k.revoked_at ? (
                            <Badge variant="outline" className="text-[10px] bg-red-500/10 text-red-300 border-red-500/30">
                              revoked
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="text-[10px] bg-emerald-500/10 text-emerald-300 border-emerald-500/30">
                              active
                            </Badge>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </CardContent>
          </Card>
        )}
      </section>
    </div>
  );
}

function Stat({
  label,
  value,
  accent,
  hint,
}: {
  label: string;
  value: string | number;
  accent: "sky" | "violet" | "amber" | "emerald";
  hint?: string;
}) {
  const cls = {
    sky: "text-sky-400",
    violet: "text-violet-400",
    amber: "text-amber-400",
    emerald: "text-emerald-400",
  }[accent];
  return (
    <Card className="shadow-none border-border/60">
      <CardContent className="pt-5 pb-4">
        <div className={`text-2xl font-semibold tabular-nums ${cls}`}>
          {value}
        </div>
        <div className="text-[10px] text-muted-foreground uppercase tracking-widest mt-1 font-medium">
          {label}
        </div>
        {hint && (
          <div className="text-[10px] text-muted-foreground/80 mt-0.5">
            {hint}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
