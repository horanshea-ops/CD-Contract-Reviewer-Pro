/**
 * Plain-sentence findings drawn from the statistics. Each sentence names how
 * many contracts or asks it rests on, and none is stated below MIN_SAMPLE.
 */

import { askOutcomes, median, MIN_SAMPLE, standardsMet } from "./stats";
import { formatTermValue, NEGOTIATED_TERMS, termByKey } from "./terms";
import { TIER_LABELS, type ContractRecord } from "./types";

export interface Insight {
  text: string;
  n: number;
}

const pct = (x: number) => `${Math.round(x)}%`;

export function insights(records: ContractRecord[]): Insight[] {
  const signed = records.filter((r) => r.status === "signed");
  const out: Insight[] = [];

  // The brand that most reliably refuses one of CD's asks.
  let firm: { brand: string; label: string; held: number; n: number } | null = null;
  const brands = new Map<string, ContractRecord[]>();
  for (const r of signed) brands.set(r.property.brand, [...(brands.get(r.property.brand) ?? []), r]);
  for (const [brand, list] of brands) {
    for (const term of NEGOTIATED_TERMS) {
      const t = askOutcomes(list, [term]);
      if (t.total < MIN_SAMPLE) continue;
      const held = (t.held / t.total) * 100;
      if (held >= 80 && (!firm || held > firm.held || (held === firm.held && t.total > firm.n))) {
        firm = { brand, label: term.label.toLowerCase(), held, n: t.total };
      }
    }
  }
  if (firm) {
    out.push({ text: `${firm.brand} refused CD's ask on ${firm.label} in ${pct(firm.held)} of ${firm.n} signed contracts.`, n: firm.n });
  }

  // The term hotels give most often.
  let easiest: { label: string; share: number; n: number } | null = null;
  for (const term of NEGOTIATED_TERMS) {
    const t = askOutcomes(signed, [term]);
    if (t.total < MIN_SAMPLE) continue;
    const share = ((t.full + t.partial) / t.total) * 100;
    if (!easiest || share > easiest.share) easiest = { label: term.label.toLowerCase(), share, n: t.total };
  }
  if (easiest) {
    out.push({ text: `Hotels moved toward CD's ask on ${easiest.label} in ${pct(easiest.share)} of ${easiest.n} asks.`, n: easiest.n });
  }

  // The market whose group rates rose fastest a year, between well-sampled years at least
  // two years apart. A market is a city and tier, so a shift toward luxury hotels isn't read as a rise.
  let rising: { market: string; from: string; to: string; change: number; yearly: number; n: number } | null = null;
  const markets = new Map<string, Map<string, number[]>>();
  for (const r of signed) {
    const rate = r.final["deal.group_rate_usd"];
    if (typeof rate !== "number") continue;
    const market = `${r.property.city} ${TIER_LABELS[r.property.tier].toLowerCase()}`;
    const years = markets.get(market) ?? new Map<string, number[]>();
    const y = r.eventStart.slice(0, 4);
    years.set(y, [...(years.get(y) ?? []), rate]);
    markets.set(market, years);
  }
  for (const [market, years] of markets) {
    const good = [...years.entries()].filter(([, rates]) => rates.length >= MIN_SAMPLE).sort(([a], [b]) => a.localeCompare(b));
    if (good.length < 2) continue;
    const [fromYear, fromRates] = good[0];
    const [toYear, toRates] = good[good.length - 1];
    const span = Number(toYear) - Number(fromYear);
    if (span < 2) continue;
    const ratio = median(toRates)! / median(fromRates)!;
    const yearly = (Math.pow(ratio, 1 / span) - 1) * 100;
    const n = fromRates.length + toRates.length;
    if (!rising || yearly > rising.yearly) rising = { market, from: fromYear, to: toYear, change: (ratio - 1) * 100, yearly, n };
  }
  if (rising && rising.yearly > 0) {
    out.push({
      text: `Group rates rose fastest at ${rising.market} hotels, up ${pct(rising.change)} from ${rising.from} to ${rising.to} across ${rising.n} signed contracts.`,
      n: rising.n,
    });
  }

  // The standard CD meets least often.
  const gaps = standardsMet(records).filter((s) => s.met.value !== null).sort((a, b) => a.met.value! - b.met.value!);
  const gap = gaps[0];
  if (gap) {
    const term = termByKey(gap.key);
    const standard = term?.kind === "number" && term.standard != null ? ` (${formatTermValue(term, term.standard)})` : "";
    out.push({
      text: `Only ${pct(gap.met.value!)} of the ${gap.met.n} signed contracts that state a ${gap.label.toLowerCase()} meet CD's standard${standard}.`,
      n: gap.met.n,
    });
  }

  return out;
}
