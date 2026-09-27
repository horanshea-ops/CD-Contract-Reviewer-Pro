/**
 * The statistics behind the Analytics tab. Pure functions over contract
 * records, so they behave the same on test data and on real contracts.
 *
 * Every figure carries its sample size. Below MIN_SAMPLE contracts a figure
 * is withheld, because a median of three contracts reads as a market fact
 * and isn't one.
 */

import { ANALYTICS_TERMS, NEGOTIATED_TERMS, isBetter, meetsStandard, type AnalyticsTerm, type NumericTerm } from "./terms";
import type { ContractRecord } from "./types";

export const MIN_SAMPLE = 5;

export interface Sampled<T> {
  n: number;
  /** Null when n is below MIN_SAMPLE. */
  value: T | null;
}

export function sampled<T>(n: number, value: T): Sampled<T> {
  return { n, value: n >= MIN_SAMPLE ? value : null };
}

export function mean(values: number[]): number | null {
  return values.length ? values.reduce((s, v) => s + v, 0) / values.length : null;
}

export function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

const signed = (records: ContractRecord[]) => records.filter((r) => r.status === "signed");

export interface Summary {
  contracts: number;
  signed: number;
  roomNights: number;
  medianRate: Sampled<number>;
  winRate: Sampled<number>;
}

export function summarize(records: ContractRecord[]): Summary {
  const done = signed(records);
  const rates = done.map((r) => r.final["deal.group_rate_usd"]).filter((v): v is number => typeof v === "number");
  const asks = askOutcomes(done);
  return {
    contracts: records.length,
    signed: done.length,
    // Summed over the contracts that state it.
    roomNights: done.reduce((s, r) => s + ((r.final["deal.room_nights"] as number | undefined) ?? 0), 0),
    medianRate: sampled(rates.length, median(rates) ?? 0),
    winRate: sampled(done.length, asks.total ? ((asks.full + asks.partial) / asks.total) * 100 : 0),
  };
}

export type AskOutcome = "full" | "partial" | "held";

/**
 * What happened to one of CD's asks, or null when CD asked for nothing on this term.
 *
 * A clause missing from the draft that CD asked to add, such as rate parity,
 * is given when the signed version has it and refused when it's still missing.
 */
export function askOutcome(term: AnalyticsTerm, record: ContractRecord): AskOutcome | null {
  const draft = record.firstDraft[term.key];
  const ask = record.requested[term.key];
  const final = record.final[term.key];
  if (ask === undefined || draft === ask) return null;
  if (draft === undefined) {
    if (term.kind !== "boolean") return null;
    return final === ask ? "full" : "held";
  }
  if (final === undefined) return null;
  if (final === ask || isBetter(term, final, ask)) return "full";
  if (isBetter(term, final, draft)) return "partial";
  return "held";
}

export interface AskTally {
  total: number;
  full: number;
  partial: number;
  held: number;
}

export function askOutcomes(records: ContractRecord[], terms: AnalyticsTerm[] = NEGOTIATED_TERMS): AskTally {
  const tally: AskTally = { total: 0, full: 0, partial: 0, held: 0 };
  for (const r of records) {
    for (const t of terms) {
      const o = askOutcome(t, r);
      if (!o) continue;
      tally.total++;
      tally[o]++;
    }
  }
  return tally;
}

export interface TermConcession {
  key: string;
  label: string;
  /** Signed contracts where CD asked for a change on this term. */
  asked: number;
  full: Sampled<number>;
  partial: Sampled<number>;
  held: Sampled<number>;
}

/** Per negotiated term, how often the hotel gave CD's ask in full, in part, or not at all. */
export function concessionsByTerm(records: ContractRecord[]): TermConcession[] {
  const done = signed(records);
  return NEGOTIATED_TERMS.map((term) => {
    const t = askOutcomes(done, [term]);
    const pct = (k: number) => (t.total ? (k / t.total) * 100 : 0);
    return {
      key: term.key,
      label: term.label,
      asked: t.total,
      full: sampled(t.total, pct(t.full)),
      partial: sampled(t.total, pct(t.partial)),
      held: sampled(t.total, pct(t.held)),
    };
  }).filter((c) => c.asked > 0);
}

export interface TrendPoint {
  period: string;
  n: number;
  value: number | null;
}

const quarterOf = (date: string) => `${date.slice(0, 4)} Q${Math.floor((Number(date.slice(5, 7)) - 1) / 3) + 1}`;

/** Median signed group rate by event quarter, or by year where quarters would be too thin. */
export function rateTrend(records: ContractRecord[], by: "quarter" | "year" = "quarter"): TrendPoint[] {
  const byQuarter = new Map<string, number[]>();
  for (const r of signed(records)) {
    const rate = r.final["deal.group_rate_usd"];
    if (typeof rate !== "number") continue;
    const q = by === "quarter" ? quarterOf(r.eventStart) : r.eventStart.slice(0, 4);
    byQuarter.set(q, [...(byQuarter.get(q) ?? []), rate]);
  }
  return [...byQuarter.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([period, rates]) => {
      const s = sampled(rates.length, median(rates) ?? 0);
      return { period, n: s.n, value: s.value === null ? null : Math.round(s.value) };
    });
}

export interface VolumePoint {
  month: string;
  signed: number;
  negotiating: number;
  lost: number;
}

/** Contracts opened per month, split by where they ended up. */
export function volumeByMonth(records: ContractRecord[]): VolumePoint[] {
  const byMonth = new Map<string, VolumePoint>();
  for (const r of records) {
    const month = r.openedAt.slice(0, 7);
    const point = byMonth.get(month) ?? { month, signed: 0, negotiating: 0, lost: 0 };
    point[r.status]++;
    byMonth.set(month, point);
  }
  return [...byMonth.values()].sort((a, b) => a.month.localeCompare(b.month));
}

export interface Bin {
  value: number;
  count: number;
}

/** How many signed contracts landed on each value of a stepped term, such as attrition. */
export function distribution(records: ContractRecord[], key: string): Bin[] {
  const counts = new Map<number, number>();
  for (const r of signed(records)) {
    const v = r.final[key];
    if (typeof v === "number") counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  return [...counts.entries()].sort(([a], [b]) => a - b).map(([value, count]) => ({ value, count }));
}

export interface StandardShare {
  key: string;
  label: string;
  met: Sampled<number>;
}

/** Share of signed contracts meeting CD's standard, per term that has one. */
export function standardsMet(records: ContractRecord[]): StandardShare[] {
  const done = signed(records);
  return ANALYTICS_TERMS.filter((t) => t.kind === "boolean" || t.standard != null).map((term) => {
    const checks = done.map((r) => r.final[term.key]).filter((v) => v !== undefined).map((v) => meetsStandard(term, v!));
    const met = checks.filter(Boolean).length;
    return { key: term.key, label: term.label, met: sampled(checks.length, checks.length ? (met / checks.length) * 100 : 0) };
  });
}

export interface GroupRow {
  id: string;
  label: string;
  contracts: number;
  signed: number;
  winRate: Sampled<number>;
  medianRate: Sampled<number>;
  medianDaysToSign: Sampled<number>;
  /** Average, not median: most contracts sign at 10%, so a median hides the ones that don't. */
  averageCommission: Sampled<number>;
}

/** One row per group (associate, brand, client), sorted by contract count. */
export function groupTable(
  records: ContractRecord[],
  keyOf: (r: ContractRecord) => { id: string; label: string }
): GroupRow[] {
  const groups = new Map<string, { label: string; records: ContractRecord[] }>();
  for (const r of records) {
    const { id, label } = keyOf(r);
    const g = groups.get(id) ?? { label, records: [] };
    g.records.push(r);
    groups.set(id, g);
  }
  return [...groups.entries()]
    .map(([id, g]) => {
      const done = signed(g.records);
      const asks = askOutcomes(done);
      const nums = (key: string) => done.map((r) => r.final[key]).filter((v): v is number => typeof v === "number");
      const days = done
        .filter((r) => r.signedAt)
        .map((r) => (Date.parse(r.signedAt!) - Date.parse(r.openedAt)) / 86_400_000);
      return {
        id,
        label: g.label,
        contracts: g.records.length,
        signed: done.length,
        winRate: sampled(done.length, asks.total ? ((asks.full + asks.partial) / asks.total) * 100 : 0),
        medianRate: sampled(done.length, median(nums("deal.group_rate_usd")) ?? 0),
        medianDaysToSign: sampled(days.length, median(days) ?? 0),
        averageCommission: sampled(nums("commission.commission_pct").length, mean(nums("commission.commission_pct")) ?? 0),
      };
    })
    .sort((a, b) => b.contracts - a.contracts);
}

export interface Benchmark {
  key: string;
  label: string;
  value: number | boolean | undefined;
  marketMedian: Sampled<number>;
  /** Share of comparable signed contracts that did better for the group. */
  shareBetter: Sampled<number>;
}

/** One contract's terms against the signed contracts it's compared with. */
export function benchmark(record: ContractRecord, comparables: ContractRecord[]): Benchmark[] {
  const pool = signed(comparables).filter((r) => r.id !== record.id);
  return NEGOTIATED_TERMS.filter((t): t is NumericTerm => t.kind === "number").map((term) => {
    const value = record.final[term.key] as number | undefined;
    const values = pool.map((r) => r.final[term.key]).filter((v): v is number => typeof v === "number");
    const better = value === undefined ? 0 : values.filter((v) => isBetter(term, v, value)).length;
    return {
      key: term.key,
      label: term.label,
      value,
      marketMedian: sampled(values.length, median(values) ?? 0),
      // A term this contract doesn't state has nothing to compare.
      shareBetter: value === undefined ? { n: values.length, value: null } : sampled(values.length, values.length ? (better / values.length) * 100 : 0),
    };
  });
}

export interface BrandCommission {
  brand: string;
  n: number;
  /** Average commission in signed contracts that state one; null below MIN_SAMPLE. */
  average: number | null;
}

/**
 * Average signed commission per brand, highest first. Brands under the sample
 * minimum come last. An average, because most contracts sign at 10% and a
 * median would hide the brands that hold at 7 or 8.
 */
export function commissionByBrand(records: ContractRecord[]): BrandCommission[] {
  const byBrand = new Map<string, number[]>();
  for (const r of signed(records)) {
    const pct = r.final["commission.commission_pct"];
    if (typeof pct === "number") byBrand.set(r.property.brand, [...(byBrand.get(r.property.brand) ?? []), pct]);
  }
  return [...byBrand.entries()]
    .map(([brand, values]) => {
      const s = sampled(values.length, mean(values) ?? 0);
      return { brand, n: s.n, average: s.value === null ? null : Math.round(s.value * 10) / 10 };
    })
    .sort((a, b) => (b.average ?? -1) - (a.average ?? -1) || b.n - a.n);
}
