import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentAssociate } from "@/lib/current-associate";
import { redirect } from "next/navigation";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/status-pill";

const STATUS_STYLE: Record<string, { label: string; className: string }> = {
  queued: { label: "Queued", className: "bg-[var(--cd-blue-pale)] text-[var(--cd-navy)]" },
  processing: { label: "Analyzing...", className: "bg-[var(--cd-blue-pale)] text-[var(--cd-navy)]" },
  complete: { label: "Complete", className: "bg-[var(--surface-muted)] text-[var(--text-secondary)] border border-[var(--border)]" },
  failed: { label: "Failed", className: "bg-[var(--severity-high-bg)] text-[var(--severity-high)]" },
};

function startOfMonthISO() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString();
}

export default async function DashboardPage() {
  const associate = await getCurrentAssociate();
  if (!associate) redirect("/login");

  const admin = createAdminClient();

  const [{ count: totalCount }, { count: inProgressCount }, { count: completedThisMonth }, { count: highSeverityCount }, { data: recentAnalyses }] =
    await Promise.all([
      admin.from("analyses").select("id", { count: "exact", head: true }).eq("associate_id", associate.id),
      admin
        .from("analyses")
        .select("id", { count: "exact", head: true })
        .eq("associate_id", associate.id)
        .in("status", ["queued", "processing"]),
      admin
        .from("analyses")
        .select("id", { count: "exact", head: true })
        .eq("associate_id", associate.id)
        .eq("status", "complete")
        .gte("created_at", startOfMonthISO()),
      admin
        .from("findings")
        .select("id, analyses!inner(associate_id)", { count: "exact", head: true })
        .eq("analyses.associate_id", associate.id)
        .eq("severity", "high"),
      admin
        .from("analyses")
        .select("id, filename, status, created_at, clients(name)")
        .eq("associate_id", associate.id)
        .order("created_at", { ascending: false })
        .limit(12),
    ]);

  const stats = [
    { label: "Total reviews", value: totalCount ?? 0 },
    { label: "In progress", value: inProgressCount ?? 0 },
    { label: "Completed this month", value: completedThisMonth ?? 0 },
    { label: "High-severity findings", value: highSeverityCount ?? 0 },
  ];

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-[var(--text-primary)]">Dashboard</h1>
          <p className="text-sm text-[var(--text-secondary)]">
            Welcome back, {associate.name.split(" ")[0]}.
          </p>
        </div>
        <Button href="/upload">Review a new contract</Button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-8">
        {stats.map((s) => (
          <Card key={s.label} padding="sm">
            <p className="text-2xl font-semibold text-[var(--cd-navy)]">{s.value}</p>
            <p className="text-xs text-[var(--text-secondary)] mt-0.5">{s.label}</p>
          </Card>
        ))}
      </div>

      <Card padding="none" className="overflow-hidden">
        <div className="px-5 py-3 border-b border-[var(--border)]">
          <h2 className="text-sm font-semibold text-[var(--text-primary)]">Recent analyses</h2>
        </div>

        {!recentAnalyses || recentAnalyses.length === 0 ? (
          <p className="text-sm text-[var(--text-secondary)] px-5 py-8 text-center">
            Nothing yet — upload a contract to get started.
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-[var(--text-muted)] border-b border-[var(--border)]">
                <th className="px-5 py-2 font-medium">Contract</th>
                <th className="px-5 py-2 font-medium">Client</th>
                <th className="px-5 py-2 font-medium">Date</th>
                <th className="px-5 py-2 font-medium text-right">Status</th>
              </tr>
            </thead>
            <tbody>
              {recentAnalyses.map((a) => {
                const style = STATUS_STYLE[a.status] ?? STATUS_STYLE.complete;
                return (
                  <tr key={a.id} className="border-b border-[var(--border)] last:border-0 hover:bg-[var(--surface-muted)]">
                    <td className="px-5 py-3">
                      <Link href={`/analyses/${a.id}`} className="font-medium text-[var(--text-primary)] hover:text-[var(--cd-navy)]">
                        {a.filename}
                      </Link>
                    </td>
                    <td className="px-5 py-3 text-[var(--text-secondary)]">
                      {(a.clients as unknown as { name: string } | null)?.name ?? "—"}
                    </td>
                    <td className="px-5 py-3 text-[var(--text-secondary)]">
                      {new Date(a.created_at).toLocaleDateString()}
                    </td>
                    <td className="px-5 py-3 text-right">
                      <StatusPill label={style.label} className={style.className} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
