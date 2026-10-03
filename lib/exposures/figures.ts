import type { NumericUnit } from "../quantities";
import type { LocatablePart } from "../redline-engine/locate";
import { normalizeValue, verify } from "../terms/validate";
import { USABLE_VERIFICATIONS, type ExtractedTerms, type StatedTerm, type TermDefinition } from "../terms/types";

/**
 * The contract's own figures, as the exposure calculations need them.
 *
 * The model reads each figure and quotes the words it comes from. A figure is
 * kept only when its quote is in the contract and states that figure, the
 * same check the terms pass makes. An exposure built on anything else would
 * be a number the app can't trace back to the contract.
 */

/** Whether a cancellation tier charges a share of the full rate or of room profit. */
export type TierCharge = "rate" | "room_profit";

/** Which room nights a cancellation tier's percentage applies to. */
export type TierBase = "minimum_room_nights" | "room_block" | "other";

export interface CancellationTier {
  label: string;
  /** Fraction: 90% is 0.9. */
  room_pct: number;
  base: TierBase;
  charges: TierCharge;
}

/** The currency the contract's amounts are written in. */
export type Currency = "$" | "€" | "£";

export interface DealFigures {
  room_block_room_nights: number | null;
  /** In the contract's currency. */
  group_rate: number | null;
  minimum_room_nights: number | null;
  /** Fraction of the block. */
  attrition_threshold_pct: number | null;
  /** Fraction of the rate owed per short room night. */
  attrition_damages_pct: number | null;
  cancellation_tiers: CancellationTier[];
  /** In the contract's currency. */
  fb_minimum: number | null;
  /** Fraction of a shortfall owed. Null when the contract states none. */
  fb_shortfall_pct: number | null;
  /** Taken from the quotes of the amounts above. Null when no amount was kept. */
  currency: Currency | null;
}

export const NO_FIGURES: DealFigures = {
  room_block_room_nights: null,
  group_rate: null,
  minimum_room_nights: null,
  attrition_threshold_pct: null,
  attrition_damages_pct: null,
  cancellation_tiers: [],
  fb_minimum: null,
  fb_shortfall_pct: null,
  currency: null,
};

type MoneyKey = "group_rate" | "fb_minimum";
type ScalarKey = Exclude<keyof DealFigures, "cancellation_tiers" | "currency" | MoneyKey>;

const UNITS: Record<ScalarKey, NumericUnit> = {
  room_block_room_nights: "rooms",
  minimum_room_nights: "rooms",
  attrition_threshold_pct: "pct",
  attrition_damages_pct: "pct",
  fb_shortfall_pct: "pct",
};

const MONEY_KEYS: readonly MoneyKey[] = ["group_rate", "fb_minimum"];

const CURRENCY_WORDS: Record<string, Currency> = { $: "$", usd: "$", "€": "€", eur: "€", euro: "€", euros: "€", "£": "£", gbp: "£" };
const MARKER = String.raw`(\$|€|£|\bUSD\b|\bEUR\b|\bGBP\b|\bEuros?\b)`;
const AMOUNT = String.raw`(\d[\d.,]*\d|\d)`;
const MARKED_BEFORE = new RegExp(`${MARKER}\\s*${AMOUNT}`, "gi");
const MARKED_AFTER = new RegExp(`${AMOUNT}\\s*${MARKER}`, "gi");

/** "20,000.00", "20.000,00" and "320,00" as numbers. */
function parseAmount(raw: string): number | null {
  const european = /^\d{1,3}(\.\d{3})*,\d{2}$/.test(raw) || /^\d+,\d{2}$/.test(raw);
  const n = Number(european ? raw.replace(/\./g, "").replace(",", ".") : raw.replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

/** Every amount in a quote that carries a currency mark, before or after it. */
function amountsIn(quote: string): { value: number; currency: Currency }[] {
  const found: { value: number; currency: Currency }[] = [];
  for (const m of quote.matchAll(MARKED_BEFORE)) {
    const value = parseAmount(m[2]);
    if (value !== null) found.push({ value, currency: CURRENCY_WORDS[m[1].toLowerCase()] });
  }
  for (const m of quote.matchAll(MARKED_AFTER)) {
    const value = parseAmount(m[1]);
    if (value !== null) found.push({ value, currency: CURRENCY_WORDS[m[2].toLowerCase()] });
  }
  return found;
}

const definition = (key: string, unit: NumericUnit): TermDefinition => ({ key, kind: "number", unit, meaning: key });

/** A figure's value when its quote is in the contract and states it, else null. */
function checked(raw: unknown, key: string, unit: NumericUnit, parts: LocatablePart[]): number | null {
  if (!raw || typeof raw !== "object") return null;
  const { value, quoted_text } = raw as { value?: unknown; quoted_text?: unknown };
  if (typeof quoted_text !== "string" || !quoted_text.trim()) return null;
  const def = definition(key, unit);
  const normalized = normalizeValue(def, value);
  if (!normalized.ok || typeof normalized.value !== "number") return null;
  return verify(def, normalized.value, quoted_text, null, parts) === "verified" ? normalized.value : null;
}

/** An amount and its currency when the quote is in the contract and states it, else null. */
function checkedMoney(raw: unknown, key: string, parts: LocatablePart[]): { value: number; currency: Currency } | null {
  if (!raw || typeof raw !== "object") return null;
  const { value, quoted_text } = raw as { value?: unknown; quoted_text?: unknown };
  if (typeof quoted_text !== "string" || !quoted_text.trim()) return null;
  const def = definition(key, "usd");
  const normalized = normalizeValue(def, value);
  if (!normalized.ok || typeof normalized.value !== "number") return null;
  const amount = normalized.value;

  // verify() places the quote in the contract and reads dollar amounts itself.
  const verdict = verify(def, amount, quoted_text, null, parts);
  if (verdict === "unlocated" || verdict === "contradicted") return null;
  if (verdict === "verified") return { value: amount, currency: "$" };
  const match = amountsIn(quoted_text).find((a) => Math.abs(a.value - amount) < 1e-9);
  return match ? { value: amount, currency: match.currency } : null;
}

const BASES: readonly TierBase[] = ["minimum_room_nights", "room_block", "other"];
const CHARGES: readonly TierCharge[] = ["rate", "room_profit"];

function checkedTiers(raw: unknown, parts: LocatablePart[]): CancellationTier[] {
  if (!Array.isArray(raw)) return [];
  const tiers: CancellationTier[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const { label, room_pct, base, charges, quoted_text } = item as Record<string, unknown>;
    if (typeof label !== "string" || !BASES.includes(base as TierBase) || !CHARGES.includes(charges as TierCharge)) continue;
    const pct = checked({ value: room_pct, quoted_text }, "cancellation.tier", "pct", parts);
    if (pct === null) continue;
    tiers.push({ label: label.trim(), room_pct: pct, base: base as TierBase, charges: charges as TierCharge });
  }
  return tiers;
}

/** Why a figure the model gave was not kept, for the server log. Null when it gave none. */
function rejection(raw: unknown, key: string, unit: NumericUnit, parts: LocatablePart[]): string | null {
  if (!raw || typeof raw !== "object") return null;
  const { value, quoted_text } = raw as { value?: unknown; quoted_text?: unknown };
  if (value === null || value === undefined) return null;
  if (typeof quoted_text !== "string" || !quoted_text.trim()) return "it came with no quote";
  const def = definition(key, unit);
  const normalized = normalizeValue(def, value);
  if (!normalized.ok || typeof normalized.value !== "number") return "its value is not a number";
  const verdict = verify(def, normalized.value, quoted_text, null, parts);
  return verdict === "unlocated" ? "its quote is not in the contract" : `its quote does not state it (${verdict})`;
}

export function checkFigures(raw: unknown, parts: LocatablePart[]): DealFigures {
  if (!raw || typeof raw !== "object") return NO_FIGURES;
  const input = raw as Record<string, unknown>;
  const figures: DealFigures = { ...NO_FIGURES, cancellation_tiers: checkedTiers(input.cancellation_tiers, parts) };
  for (const key of Object.keys(UNITS) as ScalarKey[]) {
    figures[key] = checked(input[key], key, UNITS[key], parts);
    if (figures[key] === null) logRejected(key, rejection(input[key], key, UNITS[key], parts));
  }
  for (const key of MONEY_KEYS) {
    const money = checkedMoney(input[key], key, parts);
    figures[key] = money?.value ?? null;
    figures.currency ??= money?.currency ?? null;
    if (!money) logRejected(key, rejection(input[key], key, "usd", parts));
  }

  const given = Array.isArray(input.cancellation_tiers) ? input.cancellation_tiers.length : 0;
  if (given > figures.cancellation_tiers.length) {
    console.warn(`[exposures] kept ${figures.cancellation_tiers.length} of ${given} cancellation tiers the model gave`);
  }
  return figures;
}

/** The catalog term each figure is read from. */
const SCALAR_TERMS: Record<ScalarKey, string> = {
  room_block_room_nights: "deal.room_block_room_nights",
  minimum_room_nights: "attrition.minimum_room_nights",
  attrition_threshold_pct: "attrition.threshold",
  attrition_damages_pct: "attrition.liability_rate",
  fb_shortfall_pct: "fb_minimum.shortfall_rate",
};

const MONEY_TERMS: Record<MoneyKey, string> = {
  group_rate: "deal.group_rate_usd",
  fb_minimum: "deal.fb_minimum_usd",
};

const TIER_TERMS = {
  pct: "cancellation.top_tier_pct",
  charges: "cancellation.damages_basis",
  base: "cancellation.damages_room_nights",
  schedule: "cancellation.schedule",
};

/** Every catalog term an exposure is worked out from. A reading pass must ask for at least these. */
export const EXPOSURE_TERM_KEYS: readonly string[] = [
  ...Object.values(SCALAR_TERMS),
  ...Object.values(MONEY_TERMS),
  ...Object.values(TIER_TERMS),
];

const CHARGES_OF: Record<string, TierCharge> = { gross_revenue: "rate", room_profit: "room_profit" };
const BASE_OF: Record<string, TierBase> = { minimum_commitment: "minimum_room_nights", room_block: "room_block" };

/**
 * The figures as the reading pass's checked terms give them.
 *
 * A number is kept only when its quote is in the contract and states it. An
 * amount in another currency can't be checked that way, so it is kept when its
 * quote is in the contract and carries that amount with a currency mark. A
 * term the contract states with two different values gives no figure.
 */
export function figuresFromTerms(terms: ExtractedTerms): DealFigures {
  const conflicted = new Set(terms.conflicts);
  const stated = (key: string): StatedTerm | null => {
    if (conflicted.has(key)) {
      logRejected(key, "the contract states it with more than one value");
      return null;
    }
    return terms.stated.find((t) => t.term_key === key) ?? null;
  };

  const number = (key: string): number | null => {
    const term = stated(key);
    if (!term) return null;
    if (term.verification !== "verified" || typeof term.value !== "number") {
      logRejected(key, `its quote does not state it (${term.verification})`);
      return null;
    }
    return term.value;
  };

  const money = (key: string): { value: number; currency: Currency } | null => {
    const term = stated(key);
    if (!term || typeof term.value !== "number") return null;
    const amount = term.value;
    if (term.verification === "verified") return { value: amount, currency: "$" };
    const match = term.verification === "located" ? amountsIn(term.quoted_text).find((a) => Math.abs(a.value - amount) < 1e-9) : null;
    if (!match) logRejected(key, `its quote does not state it (${term.verification})`);
    return match ? { value: amount, currency: match.currency } : null;
  };

  const choice = (key: string): string | null => {
    const term = stated(key);
    return term && USABLE_VERIFICATIONS.includes(term.verification) && typeof term.value === "string" ? term.value : null;
  };

  const figures: DealFigures = { ...NO_FIGURES, cancellation_tiers: [] };
  for (const key of Object.keys(SCALAR_TERMS) as ScalarKey[]) figures[key] = number(SCALAR_TERMS[key]);
  for (const key of MONEY_KEYS) {
    const amount = money(MONEY_TERMS[key]);
    figures[key] = amount?.value ?? null;
    figures.currency ??= amount?.currency ?? null;
  }

  // The schedule's top tier is the only one an exposure reads.
  const pct = number(TIER_TERMS.pct);
  const charges = CHARGES_OF[choice(TIER_TERMS.charges) ?? ""];
  if (pct !== null && charges) {
    const schedule = stated(TIER_TERMS.schedule)?.value;
    const nearest = Array.isArray(schedule) ? [...schedule].sort((a, b) => a.days_prior_min - b.days_prior_min)[0] : null;
    figures.cancellation_tiers = [
      {
        label: nearest?.label.trim() || "closest to arrival",
        room_pct: pct,
        base: BASE_OF[choice(TIER_TERMS.base) ?? ""] ?? "other",
        charges,
      },
    ];
  }

  return figures;
}

function logRejected(key: string, reason: string | null) {
  if (reason) console.warn(`[exposures] dropped ${key} because ${reason}`);
}
