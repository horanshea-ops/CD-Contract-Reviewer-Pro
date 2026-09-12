import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentAssociate } from "@/lib/current-associate";
import { Card } from "@/components/ui/card";
import { StatusPill } from "@/components/ui/status-pill";
import { Body, Meta, Subtitle, Title } from "@/components/ui/typography";

const STATUS_STYLE: Record<string, string> = {
  queued: "bg-[var(--cd-blue-pale)] text-[var(--cd-navy)]",
  processing: "bg-[var(--cd-blue-pale)] text-[var(--cd-navy)]",
  complete: "bg-[var(--surface-muted)] text-[var(--text-secondary)] border border-[var(--border)]",
  failed: "bg-[var(--severity-high-bg)] text-[var(--severity-high)]",
};

/**
 * §1.9.5 — the minimal round timeline. No diffing, no comparison: just
 * making the round history visible and linkable, so it gets used from the
 * first negotiation onward rather than sitting in the schema unseen.
 */
export default async function ThreadPage({ params }: { params: Promise<{ id: string }> }) {
  const associate = await getCurrentAssociate();
  if (!associate) redirect("/login");

  const { id } = await params;
  const admin = createAdminClient();

  const { data: thread } = await admin
    .from("negotiation_threads")
    .select("id, property_name, status, associate_id, clients(name)")
    .eq("id", id)
    .maybeSingle();

  if (!thread || (thread.associate_id !== associate.id && !associate.is_admin)) {
    notFound();
  }

  const { data: rounds } = await admin
    .from("analyses")
    .select("id, filename, status, created_at, round_number")
    .eq("thread_id", id)
    .order("round_number", { ascending: true });

  const roundIds = (rounds ?? []).map((r) => r.id);

  const [{ data: findingRows }, { data: exportRows }] = await Promise.all([
    roundIds.length
      ? admin.from("findings").select("analysis_id").in("analysis_id", roundIds)
      : Promise.resolve({ data: [] as { analysis_id: string }[] }),
    roundIds.length
      ? admin.from("exports").select("analysis_id, format, created_at").in("analysis_id", roundIds)
      : Promise.resolve({ data: [] as { analysis_id: string; format: string; created_at: string }[] }),
  ]);

  const findingCountByRound = new Map<string, number>();
  for (const row of findingRows ?? []) {
    findingCountByRound.set(row.analysis_id, (findingCountByRound.get(row.analysis_id) ?? 0) + 1);
  }
  const exportsByRound = new Map<string, { format: string; created_at: string }[]>();
  for (const row of exportRows ?? []) {
    const list = exportsByRound.get(row.analysis_id) ?? [];
    list.push({ format: row.format, created_at: row.created_at });
    exportsByRound.set(row.analysis_id, list);
  }

  const clientName = (thread.clients as unknown as { name: string } | null)?.name ?? null;

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <Link href="/" className="text-sm text-[var(--text-secondary)] hover:text-[var(--cd-navy)]">
        ← Back to dashboard
      </Link>

      <div className="flex items-center justify-between mt-4 mb-6">
        <div>
          <Title className="text-[var(--text-primary)] tracking-tight">{thread.property_name}</Title>
          <Body as="p" className="text-[var(--text-secondary)]">
            {clientName ?? "No client name recorded"}
          </Body>
        </div>
        <StatusPill
          label={thread.status}
          className="bg-[var(--surface-muted)] text-[var(--text-secondary)] border border-[var(--border)] capitalize"
        />
      </div>

      <Card padding="none" className="overflow-hidden">
        <div className="px-5 py-3 border-b border-[var(--border)]">
          <Subtitle className="text-[var(--text-primary)]">
            {(rounds ?? []).length} round{(rounds ?? []).length === 1 ? "" : "s"}
          </Subtitle>
        </div>
        <div className="divide-y divide-[var(--border)]">
          {(rounds ?? []).length === 0 ? (
            <Body as="p" className="px-5 py-4 text-[var(--text-secondary)]">
              No rounds yet.
            </Body>
          ) : (
            (rounds ?? []).map((round) => {
              const sent = exportsByRound.get(round.id) ?? [];
              return (
                <Link
                  key={round.id}
                  href={`/analyses/${round.id}`}
                  className="block px-5 py-4 hover:bg-[var(--surface-muted)] transition-colors"
                >
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <Body as="p" className="font-medium text-[var(--text-primary)]">
                        Round {round.round_number} · {round.filename}
                      </Body>
                      <Meta as="p" className="text-[var(--text-secondary)] mt-0.5">
                        {new Date(round.created_at).toLocaleDateString()}
                        {" · "}
                        {findingCountByRound.get(round.id) ?? 0} finding
                        {(findingCountByRound.get(round.id) ?? 0) === 1 ? "" : "s"}
                        {sent.length > 0 &&
                          ` · sent ${sent.map((s) => s.format).join(", ")} ${new Date(sent[0].created_at).toLocaleDateString()}`}
                      </Meta>
                    </div>
                    <StatusPill
                      label={round.status}
                      className={STATUS_STYLE[round.status] ?? STATUS_STYLE.complete}
                    />
                  </div>
                </Link>
              );
            })
          )}
        </div>
      </Card>
    </div>
  );
}
