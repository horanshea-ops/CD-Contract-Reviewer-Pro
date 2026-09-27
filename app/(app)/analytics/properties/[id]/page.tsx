import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCurrentAssociate } from "@/lib/current-associate";
import { scopeFor } from "@/lib/analytics/access";
import { analyticsEnabled, loadAnalyticsData, sharesOriginals } from "@/lib/analytics/source";
import { benchmark, concessionsByTerm, MIN_SAMPLE, rateTrend, summarize } from "@/lib/analytics/stats";
import { formatTermValue, termByKey } from "@/lib/analytics/terms";
import { TIER_LABELS } from "@/lib/analytics/types";
import { Card } from "@/components/ui/card";
import { Body, Meta, Subtitle, Title } from "@/components/ui/typography";
import { ConcessionChart, RateTrendChart } from "@/components/analytics/charts";
import { ChartCard, ContractsTable, StatTiles, TestDataBanner, pct, show, usd } from "@/components/analytics/parts";

export default async function PropertyPage({ params }: { params: Promise<{ id: string }> }) {
  if (!analyticsEnabled()) notFound();
  const associate = await getCurrentAssociate();
  if (!associate) redirect("/login");

  const { id } = await params;
  const scope = scopeFor(associate, sharesOriginals());
  const data = await loadAnalyticsData();
  const records = data.contracts.filter((c) => c.property.id === id);
  if (!records.length) notFound();

  const property = records[0].property;
  const summary = summarize(records);
  const signedHere = records.filter((r) => r.status === "signed");

  // A single hotel rarely has enough contracts per term, so concessions fall back to the whole brand.
  const own = concessionsByTerm(records).filter((c) => c.full.value !== null);
  const brandRecords = data.contracts.filter((c) => c.property.brand === property.brand);
  const concessions = own.length ? own : concessionsByTerm(brandRecords);
  const concessionScope = own.length ? "this hotel" : `all ${property.brand} hotels`;

  // The latest signed contract here, against signed contracts in the same city, or the same tier when the city is thin.
  const latest = [...signedHere].sort((a, b) => b.signedAt!.localeCompare(a.signedAt!))[0];
  const cityPool = data.contracts.filter((c) => c.property.city === property.city && c.status === "signed");
  const pool = cityPool.length >= MIN_SAMPLE * 2 ? cityPool : data.contracts.filter((c) => c.property.tier === property.tier);
  const poolLabel = pool === cityPool ? `signed contracts in ${property.city}` : `signed ${TIER_LABELS[property.tier].toLowerCase()} contracts`;
  const rows = latest ? benchmark(latest, pool) : [];

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <Link href="/analytics" className="text-sm text-[var(--cd-navy)] underline underline-offset-2">
        All analytics
      </Link>
      <div className="mb-6 mt-2">
        <Title className="tracking-tight text-[var(--text-primary)]">{property.name}</Title>
        <Body as="p" className="text-[var(--text-secondary)]">
          {property.brand} · {property.parentCompany} · {TIER_LABELS[property.tier]} · {property.guestRooms.toLocaleString("en-US")} guest rooms
        </Body>
        <Meta as="p" className="text-[var(--text-muted)]">
          {property.address}, {[property.city, property.state, property.country].filter(Boolean).join(", ")}
        </Meta>
      </div>

      {data.kind === "test" && <TestDataBanner />}

      <StatTiles
        tiles={[
          { label: "Contracts with this hotel", value: String(summary.contracts), note: `${summary.signed} signed` },
          { label: "Room nights signed", value: summary.roomNights.toLocaleString("en-US") },
          { label: "Median group rate", value: show(summary.medianRate, usd) },
          { label: "CD asks won", value: show(summary.winRate, pct), note: "in full or partway" },
        ]}
      />

      <div className="mb-6 grid gap-6 lg:grid-cols-2">
        <ChartCard title="What this hotel gives" note={`Outcome of each CD ask, across ${concessionScope}.`} height={380}>
          <ConcessionChart rows={concessions} />
        </ChartCard>
        <ChartCard title="Group rate trend" note={`Median signed rate by event year, across all ${property.brand} hotels.`} height={380}>
          <RateTrendChart points={rateTrend(brandRecords, "year")} />
        </ChartCard>
      </div>

      {latest && (
        <Card padding="none" className="mb-6 overflow-hidden">
          <div className="border-b border-[var(--border)] px-5 py-3">
            <Subtitle className="text-[var(--text-primary)]">Latest signed terms against the market</Subtitle>
            <Meta as="p" className="text-[var(--text-secondary)]">
              {latest.eventName}, signed {latest.signedAt}, compared with {pool.filter((c) => c.status === "signed").length} {poolLabel}.
            </Meta>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--border)] text-left">
                  <Meta as="th" className="px-4 py-2 font-medium text-[var(--text-muted)]">Term</Meta>
                  <Meta as="th" className="px-4 py-2 font-medium text-[var(--text-muted)]">This hotel</Meta>
                  <Meta as="th" className="px-4 py-2 font-medium text-[var(--text-muted)]">Market median</Meta>
                  <Meta as="th" className="px-4 py-2 font-medium text-[var(--text-muted)]">Contracts that did better</Meta>
                </tr>
              </thead>
              <tbody>
                {rows.map((b) => {
                  const term = termByKey(b.key)!;
                  return (
                    <tr key={b.key} className="border-b border-[var(--border)] last:border-0">
                      <td className="px-4 py-2.5 text-[var(--text-primary)]">{b.label}</td>
                      <td className="px-4 py-2.5 text-[var(--text-secondary)]">{formatTermValue(term, b.value)}</td>
                      <td className="px-4 py-2.5 text-[var(--text-secondary)]">
                        {b.marketMedian.value === null ? "Too few" : formatTermValue(term, b.marketMedian.value)}
                      </td>
                      <td className="px-4 py-2.5 text-[var(--text-secondary)]">{show(b.shareBetter, pct)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <ContractsTable title="Contract history" records={records} scope={scope} showProperty={false} />
    </div>
  );
}
