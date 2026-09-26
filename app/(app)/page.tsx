import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentAssociate } from "@/lib/current-associate";
import { redirect } from "next/navigation";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Body, Display, Meta, Title } from "@/components/ui/typography";
import { RecentAnalysesCard } from "@/components/recent-analyses-card";
import { limitReachedMessage, monthStartUTC, reviewAllowance } from "@/lib/review-allowance";

export default async function DashboardPage() {
  const associate = await getCurrentAssociate();
  if (!associate) redirect("/login");

  const admin = createAdminClient();

  const now = new Date();
  const [allowance, { count: inProgressCount }, { count: completedThisMonth }, { count: needingDecisions }, { data: recentAnalyses }] =
    await Promise.all([
      reviewAllowance(admin, associate.id, now),
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
        .gte("created_at", monthStartUTC(now).toISOString()),
      // Complete reviews with at least one finding that has no decision yet.
      admin
        .from("analyses")
        .select("id, findings!inner(id, finding_actions(id))", { count: "exact", head: true })
        .eq("associate_id", associate.id)
        .eq("status", "complete")
        .is("findings.finding_actions", null),
      admin
        .from("analyses")
        .select("id, filename, status, created_at, clients(name)")
        .eq("associate_id", associate.id)
        .order("created_at", { ascending: false })
        .limit(12),
    ]);

  const stats: { label: string; value: number }[] = [
    { label: "Reviews left this month", value: allowance.remaining },
    { label: "In progress", value: inProgressCount ?? 0 },
    { label: "Completed this month", value: completedThisMonth ?? 0 },
    { label: "Reviews needing decisions", value: needingDecisions ?? 0 },
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
        {allowance.remaining > 0 ? (
          <Button href="/upload">Review a new contract</Button>
        ) : (
          <Body as="p" className="max-w-xs text-right text-[var(--text-secondary)]">
            {limitReachedMessage(allowance)}
          </Body>
        )}
      </div>

      {/* The 1px gap over a border-coloured background draws the dividers, whichever way the grid wraps. */}
      <Card padding="none" className="mb-6 overflow-hidden">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-px bg-[var(--border)]">
          {stats.map((s) => (
            <div key={s.label} className="bg-white px-5 py-4">
              <Display className="text-[var(--cd-navy)]">{s.value}</Display>
              <Meta as="p" className="text-[var(--text-secondary)] mt-0.5">
                {s.label}
              </Meta>
            </div>
          ))}
        </div>
      </Card>

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
