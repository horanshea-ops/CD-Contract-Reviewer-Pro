/**
 * The contract terms the Analytics tab compares across contracts.
 *
 * Keys match the hotel-v2 term catalog (lib/terms/catalog.ts), so extracted
 * terms map straight across once the database source exists. `deal.room_nights`
 * is the one key the catalog doesn't have yet.
 *
 * The list holds only terms a contract states outright: a number, a
 * percentage, or a named clause. Terms that take judgment to read, such as
 * credit for high-occupancy nights, are left out until extraction proves it
 * reads them reliably.
 *
 * A term the contract doesn't state is missing, never zero or false. Every
 * figure counts only the contracts that state the term.
 *
 * `standard` is CD's position from lib/standards/v1.ts, reduced to a test a
 * number or yes/no can pass. `better` says which way a move helps the group.
 */

export type TermUnit = "usd" | "pct" | "days" | "rooms" | "nights" | "ratio";

export interface NumericTerm {
  key: string;
  label: string;
  kind: "number";
  unit: TermUnit;
  better: "lower" | "higher";
  /** Meets CD's standard at or beyond this value, in the `better` direction. */
  standard?: number;
  /** Negotiated: the hotel drafts one value and CD asks for another. */
  negotiated: boolean;
}

export interface BooleanTerm {
  key: string;
  label: string;
  kind: "boolean";
  /** True is always the group-friendly answer. */
  standard: true;
  negotiated: true;
}

export type AnalyticsTerm = NumericTerm | BooleanTerm;

export const ANALYTICS_TERMS: AnalyticsTerm[] = [
  { key: "deal.group_rate_usd", label: "Group rate", kind: "number", unit: "usd", better: "lower", negotiated: true },
  { key: "deal.room_nights", label: "Room nights", kind: "number", unit: "nights", better: "higher", negotiated: false },
  { key: "deal.peak_night_rooms", label: "Peak night rooms", kind: "number", unit: "rooms", better: "higher", negotiated: false },
  { key: "deal.fb_minimum_usd", label: "F&B minimum", kind: "number", unit: "usd", better: "lower", negotiated: true },
  { key: "attrition.threshold", label: "Attrition threshold", kind: "number", unit: "pct", better: "lower", standard: 70, negotiated: true },
  { key: "cutoff_date.days_prior", label: "Cutoff", kind: "number", unit: "days", better: "lower", standard: 21, negotiated: true },
  { key: "cancellation.top_tier_pct", label: "Top cancellation tier", kind: "number", unit: "pct", better: "lower", negotiated: true },
  { key: "rebates.comp_room_ratio", label: "Comp room ratio", kind: "number", unit: "ratio", better: "lower", standard: 40, negotiated: true },
  { key: "commission.commission_pct", label: "Commission", kind: "number", unit: "pct", better: "higher", standard: 10, negotiated: true },
  { key: "mandatory_fees.resort_fee_usd", label: "Resort fee", kind: "number", unit: "usd", better: "lower", standard: 0, negotiated: true },
  { key: "cancellation.resale_credit", label: "Resale credit", kind: "boolean", standard: true, negotiated: true },
  { key: "force_majeure.covers_epidemic", label: "Force majeure covers epidemics", kind: "boolean", standard: true, negotiated: true },
  { key: "rate_parity.guaranteed", label: "Rate parity", kind: "boolean", standard: true, negotiated: true },
];

export const NEGOTIATED_TERMS = ANALYTICS_TERMS.filter((t) => t.negotiated);

export function termByKey(key: string): AnalyticsTerm | undefined {
  return ANALYTICS_TERMS.find((t) => t.key === key);
}

export type TermValue = number | boolean;

/** True when `a` is better for the group than `b`. */
export function isBetter(term: AnalyticsTerm, a: TermValue, b: TermValue): boolean {
  if (term.kind === "boolean") return a === true && b === false;
  return term.better === "lower" ? (a as number) < (b as number) : (a as number) > (b as number);
}

export function meetsStandard(term: AnalyticsTerm, value: TermValue): boolean | null {
  if (term.kind === "boolean") return value === true;
  if (term.standard == null) return null;
  const v = value as number;
  return term.better === "lower" ? v <= term.standard : v >= term.standard;
}

export function formatTermValue(term: AnalyticsTerm, value: TermValue | undefined): string {
  if (value === undefined) return "—";
  if (term.kind === "boolean") return value ? "Yes" : "No";
  const v = value as number;
  switch (term.unit) {
    case "usd":
      return `$${Math.round(v).toLocaleString("en-US")}`;
    case "pct":
      return `${Number.isInteger(v) ? v : v.toFixed(1)}%`;
    case "days":
      return `${Math.round(v)} days`;
    case "rooms":
    case "nights":
      return Math.round(v).toLocaleString("en-US");
    case "ratio":
      return `1 per ${Math.round(v)}`;
  }
}
