import { notFound, redirect } from "next/navigation";
import { getCurrentAssociate } from "@/lib/current-associate";
import { scopeFor } from "@/lib/analytics/access";
import { applyFilters, filterOptions, parseFilters } from "@/lib/analytics/filters";
import { insights } from "@/lib/analytics/insights";
import { analyticsEnabled, loadAnalyticsData, sharesOriginals } from "@/lib/analytics/source";
import { commissionByBrand, concessionsByTerm, distribution, groupTable, rateTrend, standardsMet, summarize, volumeByMonth } from "@/lib/analytics/stats";
import { Card } from "@/components/ui/card";
import { Body, Subtitle, Title } from "@/components/ui/typography";
import { CommissionChart, ConcessionChart, DistributionChart, RateTrendChart, VolumeChart } from "@/components/analytics/charts";
import { FilterBar } from "@/components/analytics/filter-bar";
import {
  ChartCard,
  GroupTable,
  InsightsCard,
  StandardsCard,
  StatTiles,
  TestDataBanner,
  pct,
  show,
  usd,
} from "@/components/analytics/parts";

export default async function AnalyticsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (!analyticsEnabled()) notFound();
  const associate = await getCurrentAssociate();
  if (!associate) redirect("/login");

  const scope = scopeFor(associate, sharesOriginals());
  const data = await loadAnalyticsData();
  const filters = parseFilters(await searchParams, scope);
  const records = applyFilters(data.contracts, filters);
  const summary = summarize(records);

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <div className="mb-6">
        <Title className="tracking-tight text-[var(--text-primary)]">Analytics</Title>
        <Body as="p" className="text-[var(--text-secondary)]">
          What CD has signed before, by brand, hotel and market.
        </Body>
      </div>

      {data.kind === "test" && <TestDataBanner />}

      {data.contracts.length === 0 ? (
        <Card>
          <Body as="p" className="text-[var(--text-secondary)]">
            No signed contracts are loaded yet. Figures appear here once signed versions are recorded.
          </Body>
        </Card>
      ) : (
        <>
          <Card className="mb-6">
            <FilterBar filters={filters} options={filterOptions(data.contracts, scope)} />
          </Card>

          <StatTiles
            tiles={[
              { label: "Contracts", value: summary.contracts.toLocaleString("en-US"), note: `${summary.signed} signed` },
              { label: "Room nights signed", value: summary.roomNights.toLocaleString("en-US") },
              { label: "Median group rate", value: show(summary.medianRate, usd) },
              { label: "CD asks won", value: show(summary.winRate, pct), note: "in full or partway" },
            ]}
          />

          <InsightsCard items={insights(records)} />

          <div className="mb-6 grid gap-6 lg:grid-cols-2">
            <ChartCard title="Group rate trend" note="Median signed rate by event quarter.">
              <RateTrendChart points={rateTrend(records)} />
            </ChartCard>
            <ChartCard title="Attrition thresholds signed" note="Pickup the group must reach before damages apply. Lower is better.">
              <DistributionChart bins={distribution(records, "attrition.threshold")} standard={70} unit="%" />
            </ChartCard>
            <ChartCard title="What hotels give" note="Outcome of each CD ask in signed contracts." height={380}>
              <ConcessionChart rows={concessionsByTerm(records)} />
            </ChartCard>
            <ChartCard title="Commission by brand" note="Average commission in signed contracts, per brand. Higher is better." height={380}>
              <CommissionChart rows={commissionByBrand(records)} standard={10} />
            </ChartCard>
            <div className="lg:col-span-2">
              <ChartCard title="Contracts by month" note="By the month the first draft arrived.">
                <VolumeChart points={volumeByMonth(records)} />
              </ChartCard>
            </div>
          </div>

          <div className="mb-6">
            <GroupTable
              title="You and other associates"
              note="Your contracts against everyone else's under the same filters. Other associates are counted together and never named."
              rows={groupTable(
                records,
                (r) => (r.associate.id === scope.associateId ? { id: "you", label: "You" } : { id: "others", label: "Other associates" })
              ).sort((a, b) => (a.id === "you" ? -1 : b.id === "you" ? 1 : 0))}
            />
          </div>

          {scope.isAdmin && (
            <section aria-labelledby="management" className="space-y-6">
              <Subtitle id="management" className="text-[var(--text-primary)]">
                Management
              </Subtitle>
              <GroupTable title="By associate" rows={groupTable(records, (r) => ({ id: r.associate.id, label: r.associate.name }))} />
              <GroupTable
                title="By brand"
                note="Asks won is how often the brand moved toward CD, in full or partway."
                rows={groupTable(records, (r) => ({ id: r.property.brand, label: r.property.brand }))}
                linkFor={(g) => `/analytics?brand=${encodeURIComponent(g.id)}`}
              />
              <GroupTable title="By client" rows={groupTable(records, (r) => ({ id: r.client.id, label: r.client.name }))} />
              <StandardsCard rows={standardsMet(records)} />
            </section>
          )}
        </>
      )}
    </div>
  );
}
