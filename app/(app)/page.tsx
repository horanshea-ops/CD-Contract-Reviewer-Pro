import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentAssociate } from "@/lib/current-associate";
import { redirect } from "next/navigation";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Body, Display, Meta, Title } from "@/components/ui/typography";
import { RecentAnalysesCard } from "@/components/recent-analyses-card";

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
          <Title className="text-[var(--text-primary)] tracking-tight">Dashboard</Title>
          <Body as="p" className="text-[var(--text-secondary)]">
            Welcome back, {associate.name.split(" ")[0]}.
          </Body>
        </div>
        <Button href="/upload" gradient>
          Review a new contract
        </Button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-8">
        {stats.map((s) => (
          <Card key={s.label} padding="sm" elevated>
            <Display className="text-[var(--cd-navy)]">{s.value}</Display>
            <Meta as="p" className="text-[var(--text-secondary)] mt-0.5">
              {s.label}
            </Meta>
          </Card>
        ))}
      </div>

      <RecentAnalysesCard
        analyses={(recentAnalyses ?? []).map((a) => ({
          id: a.id,
          filename: a.filename,
          status: a.status,
          created_at: a.created_at,
          clientName: (a.clients as unknown as { name: string } | null)?.name ?? null,
        }))}
      />
    </div>
  );
}
