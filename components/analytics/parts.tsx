import Link from "next/link";
import type { ReactNode } from "react";
import { Card } from "@/components/ui/card";
import { StatusPill } from "@/components/ui/status-pill";
import { Body, Display, Meta, Subtitle } from "@/components/ui/typography";
import type { Insight } from "@/lib/analytics/insights";
import type { AnalyticsScope } from "@/lib/analytics/access";
import type { GroupRow, Sampled, StandardShare } from "@/lib/analytics/stats";
import { formatTermValue, termByKey } from "@/lib/analytics/terms";
import type { ContractRecord, ContractStatus } from "@/lib/analytics/types";

export const usd = (v: number) => `$${Math.round(v).toLocaleString("en-US")}`;
export const pct = (v: number) => `${Math.round(v)}%`;

/** A withheld figure says why, rather than showing a number too thin to trust. */
export function show(s: Sampled<number>, format: (v: number) => string): string {
  return s.value === null ? "Too few" : format(s.value);
}

export function TestDataBanner() {
  return (
    <div role="note" className="mb-6 rounded-md border border-[var(--severity-medium)] bg-[var(--severity-medium-bg)] px-4 py-3">
      <Body as="p" className="font-medium text-[var(--severity-medium)]">
        Test data: not real contracts
      </Body>
      <Meta as="p" className="mt-0.5 text-[var(--text-secondary)]">
        Every hotel, brand, client and figure here is invented to show how the tab will work. The cities are real.
      </Meta>
    </div>
  );
}

export function StatTiles({ tiles }: { tiles: { label: string; value: string; note?: string }[] }) {
  return (
    <Card padding="none" className="mb-6 overflow-hidden">
      <div className="grid grid-cols-2 gap-px bg-[var(--border)] lg:grid-cols-4">
        {tiles.map((t) => (
          <div key={t.label} className="bg-white px-5 py-4">
            <Display className="text-[var(--cd-navy)]">{t.value}</Display>
            <Meta as="p" className="mt-0.5 text-[var(--text-secondary)]">
              {t.label}
            </Meta>
            {t.note && (
              <Meta as="p" className="text-[var(--text-muted)]">
                {t.note}
              </Meta>
            )}
          </div>
        ))}
      </div>
    </Card>
  );
}

export function ChartCard({ title, note, height = 260, children }: { title: string; note?: string; height?: number; children: ReactNode }) {
  return (
    <Card>
      <Subtitle className="text-[var(--text-primary)]">{title}</Subtitle>
      {note && (
        <Meta as="p" className="mt-0.5 text-[var(--text-secondary)]">
          {note}
        </Meta>
      )}
      <div className="mt-3" style={{ height }}>
        {children}
      </div>
    </Card>
  );
}

export function InsightsCard({ items }: { items: Insight[] }) {
  if (!items.length) return null;
  return (
    <Card className="mb-6">
      <Subtitle className="text-[var(--text-primary)]">What the contracts show</Subtitle>
      <ul className="mt-2 space-y-1.5">
        {items.map((i) => (
          <li key={i.text} className="flex gap-2 text-sm text-[var(--text-primary)]">
            <span aria-hidden="true" className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--cd-blue)]" />
            <span>{i.text}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

const STATUS_STYLE: Record<ContractStatus, { label: string; className: string }> = {
  signed: { label: "Signed", className: "bg-[var(--status-success-bg)] text-[var(--status-success)]" },
  negotiating: { label: "Negotiating", className: "bg-[var(--cd-blue-pale)] text-[var(--cd-navy)]" },
  lost: { label: "Lost", className: "bg-[var(--severity-low-bg)] text-[var(--severity-low)]" },
};

const th = "px-4 py-2 font-medium text-[var(--text-muted)] whitespace-nowrap";
const td = "px-4 py-2.5 text-[var(--text-secondary)] whitespace-nowrap";

/**
 * Every contract, as a library. Other associates' names show only to admins,
 * and the original file only where the viewer may open it. Anyone can open
 * the term sheet, which names no associate.
 */
export function ContractsTable({
  title,
  records,
  scope,
  limit = 50,
  showProperty = true,
}: {
  title: string;
  records: ContractRecord[];
  scope: AnalyticsScope;
  limit?: number;
  showProperty?: boolean;
}) {
  const shown = records.slice(0, limit);
  const term = (key: string, r: ContractRecord) => formatTermValue(termByKey(key)!, r.final[key]);
  const who = (r: ContractRecord) =>
    r.associate.id === scope.associateId ? "You" : scope.showsAssociate(r) ? r.associate.name : "Another associate";

  return (
    <Card padding="none" className="overflow-hidden">
      <div className="border-b border-[var(--border)] px-5 py-3">
        <Subtitle className="text-[var(--text-primary)]">{title}</Subtitle>
        <Meta as="p" className="text-[var(--text-secondary)]">
          {records.length > limit ? `The ${limit} most recent of ${records.length}.` : `${records.length} contracts.`} A dash means the contract
          doesn&apos;t state that term.
        </Meta>
      </div>
      {shown.length === 0 ? (
        <Body as="p" className="px-5 py-8 text-center text-[var(--text-secondary)]">
          No contracts match these filters.
        </Body>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--border)] text-left">
                {showProperty && <Meta as="th" className={th}>Hotel</Meta>}
                <Meta as="th" className={th}>Client</Meta>
                <Meta as="th" className={th}>Event</Meta>
                <Meta as="th" className={th}>Associate</Meta>
                <Meta as="th" className={th}>Rate</Meta>
                <Meta as="th" className={th}>Attrition</Meta>
                <Meta as="th" className={th}>Cutoff</Meta>
                <Meta as="th" className={th}>Status</Meta>
                <Meta as="th" className={th}>Files</Meta>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.id} className="border-b border-[var(--border)] last:border-0 hover:bg-[var(--surface-muted)]">
                  {showProperty && (
                    <td className="min-w-[15rem] px-4 py-2.5">
                      <Link href={`/analytics/properties/${r.property.id}`} className="font-medium text-[var(--text-primary)] hover:text-[var(--cd-navy)]">
                        {r.property.name}
                      </Link>
                      <Meta as="p" className="text-[var(--text-muted)]">
                        {r.property.brand}
                      </Meta>
                    </td>
                  )}
                  <td className={td}>{r.client.name}</td>
                  <td className={td}>{r.eventStart}</td>
                  <td className={td}>{who(r)}</td>
                  <td className={td}>{term("deal.group_rate_usd", r)}</td>
                  <td className={td}>{term("attrition.threshold", r)}</td>
                  <td className={td}>{term("cutoff_date.days_prior", r)}</td>
                  <td className="px-4 py-2.5 whitespace-nowrap">
                    <StatusPill label={STATUS_STYLE[r.status].label} className={STATUS_STYLE[r.status].className} />
                  </td>
                  <td className="space-x-3 px-4 py-2.5 whitespace-nowrap">
                    <a href={`/api/analytics/term-sheets/${r.id}`} target="_blank" rel="noopener" className="text-[var(--cd-navy)] underline underline-offset-2">
                      Term sheet
                    </a>
                    {r.analysisId && scope.canOpenOriginal(r) && (
                      <Link href={`/analyses/${r.analysisId}`} className="text-[var(--cd-navy)] underline underline-offset-2">
                        Review
                      </Link>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

export function GroupTable({ title, note, rows, linkFor }: { title: string; note?: string; rows: GroupRow[]; linkFor?: (row: GroupRow) => string }) {
  return (
    <Card padding="none" className="overflow-hidden">
      <div className="border-b border-[var(--border)] px-5 py-3">
        <Subtitle className="text-[var(--text-primary)]">{title}</Subtitle>
        {note && (
          <Meta as="p" className="text-[var(--text-secondary)]">
            {note}
          </Meta>
        )}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--border)] text-left">
              <Meta as="th" className={th}>Name</Meta>
              <Meta as="th" className={th}>Contracts</Meta>
              <Meta as="th" className={th}>Signed</Meta>
              <Meta as="th" className={th}>Asks won</Meta>
              <Meta as="th" className={th}>Median rate</Meta>
              <Meta as="th" className={th}>Days to sign</Meta>
              <Meta as="th" className={th}>Avg. commission</Meta>
            </tr>
          </thead>
          <tbody>
            {rows.map((g) => (
              <tr key={g.id} className="border-b border-[var(--border)] last:border-0">
                <td className="px-4 py-2.5 font-medium text-[var(--text-primary)] whitespace-nowrap">
                  {linkFor ? (
                    <Link href={linkFor(g)} className="hover:text-[var(--cd-navy)]">
                      {g.label}
                    </Link>
                  ) : (
                    g.label
                  )}
                </td>
                <td className={td}>{g.contracts}</td>
                <td className={td}>{g.signed}</td>
                <td className={td}>{show(g.winRate, pct)}</td>
                <td className={td}>{show(g.medianRate, usd)}</td>
                <td className={td}>{show(g.medianDaysToSign, (v) => `${Math.round(v)}`)}</td>
                <td className={td}>{show(g.averageCommission, (v) => `${v.toFixed(1)}%`)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

/** Share of signed contracts meeting each of CD's standards, as bars. */
export function StandardsCard({ rows }: { rows: StandardShare[] }) {
  return (
    <Card>
      <Subtitle className="text-[var(--text-primary)]">Signed contracts meeting CD&apos;s standard</Subtitle>
      <ul className="mt-3 space-y-2">
        {rows.map((s) => (
          <li key={s.key} className="grid grid-cols-[minmax(0,11rem)_1fr_3rem] items-center gap-3 text-sm">
            <span className="truncate text-[var(--text-secondary)]">{s.label}</span>
            <span className="h-2 rounded-full bg-[var(--surface-muted)]">
              {s.met.value !== null && (
                <span className="block h-2 rounded-full bg-[var(--cd-navy)]" style={{ width: `${s.met.value}%` }} />
              )}
            </span>
            <span className="text-right font-medium text-[var(--text-primary)]">{show(s.met, pct)}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}
