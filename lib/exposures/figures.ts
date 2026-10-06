import { parseQuantities } from "../quantities";
import { USABLE_VERIFICATIONS, type ExtractedTerms, type StatedTerm } from "../terms/types";

/**
 * The contract's own figures, as the exposure calculations need them.
 *
 * The reading pass records each term with the words it comes from, and checks
 * each quote against the contract (lib/terms/validate.ts). A figure is kept
 * only when its term passed that check. An exposure built on anything else
 * would be a number the app can't trace back to the contract.
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
  /** Fraction of room revenue the hotel pays as commission. No exposure uses it; the must-raise check does. */
  commission_pct: number | null;
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
  commission_pct: null,
  currency: null,
};

type MoneyKey = "group_rate" | "fb_minimum";
type ScalarKey = Exclude<keyof DealFigures, "cancellation_tiers" | "currency" | MoneyKey>;

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

/** The catalog term each figure is read from. */
const SCALAR_TERMS: Record<ScalarKey, string> = {
  room_block_room_nights: "deal.room_block_room_nights",
  minimum_room_nights: "attrition.minimum_room_nights",
  attrition_threshold_pct: "attrition.threshold",
  attrition_damages_pct: "attrition.liability_rate",
  fb_shortfall_pct: "fb_minimum.shortfall_rate",
  commission_pct: "commission.commission_pct",
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

/** Every catalog term a figure is read from. A reading pass must ask for at least these. */
export const EXPOSURE_TERM_KEYS: readonly string[] = [
  ...Object.values(SCALAR_TERMS),
  ...Object.values(MONEY_TERMS),
  ...Object.values(TIER_TERMS),
];

/**
 * The terms behind the findings the app raises itself (lib/must-raise.ts): the
 * commission rate, the attrition floor and the F&B shortfall rate. A reading
 * pass asks for these alone while exposure math is archived.
 */
export const MUST_RAISE_TERM_KEYS: readonly string[] = [
  SCALAR_TERMS.room_block_room_nights,
  SCALAR_TERMS.minimum_room_nights,
  SCALAR_TERMS.attrition_threshold_pct,
  SCALAR_TERMS.fb_shortfall_pct,
  SCALAR_TERMS.commission_pct,
];

const asPercent = (fraction: number) => `${Number((fraction * 100).toFixed(4))}%`;

const CHARGES_OF: Record<string, TierCharge> = { gross_revenue: "rate", room_profit: "room_profit" };
const BASE_OF: Record<string, TierBase> = { minimum_commitment: "minimum_room_nights", room_block: "room_block" };

/** The three answers about the tier closest to arrival. A cancellation figure needs all of them. */
export const TIER_ANSWER_KEYS: readonly string[] = [TIER_TERMS.pct, TIER_TERMS.charges, TIER_TERMS.base];

/** What happened to a term on its way to a figure. Kept with the review, so a missing exposure can be explained afterwards. */
export interface FigureNote {
  term_key: string;
  reason: string;
}

export interface FigureReading {
  figures: DealFigures;
  notes: FigureNote[];
  /**
   * The tier answers a reading with cancellation terms in it left out or gave
   * unusably. A second reading can fill these. A term read with two values
   * isn't among them, since another reading can't settle it.
   */
  unanswered: string[];
}

/**
 * The figures as the reading pass's checked terms give them, with a note for
 * each term that was read and gave none.
 *
 * A number is kept only when its quote is in the contract and states it. An
 * amount in another currency can't be checked that way, so it is kept when its
 * quote is in the contract and carries that amount with a currency mark. A
 * term the contract states with two different values gives no figure.
 */
export function readFigures(terms: ExtractedTerms): FigureReading {
  const notes: FigureNote[] = [];
  const note = (term_key: string, reason: string) => {
    if (notes.some((n) => n.term_key === term_key && n.reason === reason)) return;
    notes.push({ term_key, reason });
  };

  const conflicted = new Set(terms.conflicts);
  const stated = (key: string): StatedTerm | null => {
    if (conflicted.has(key)) {
      note(key, "The reading gave more than one value for it, so none is used.");
      return null;
    }
    return terms.stated.find((t) => t.term_key === key) ?? null;
  };

  const number = (key: string): number | null => {
    const term = stated(key);
    if (!term) return null;
    if (term.verification !== "verified" || typeof term.value !== "number") {
      note(key, `Its quote does not single out the value (${term.verification}).`);
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
    if (!match) note(key, `Its quote does not state the amount (${term.verification}).`);
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

  // The tier closest to arrival is the only one an exposure reads.
  const scheduleTerm = stated(TIER_TERMS.schedule);
  const tiers = scheduleTerm && USABLE_VERIFICATIONS.includes(scheduleTerm.verification) && Array.isArray(scheduleTerm.value) ? scheduleTerm.value : [];
  const nearest = [...tiers].sort((a, b) => a.days_prior_min - b.days_prior_min)[0] ?? null;
  const scheduleStates = (pct: number) =>
    parseQuantities(scheduleTerm?.quoted_text ?? "").some((q) => q.unit === "pct" && Math.abs(q.value - pct) < 1e-9);

  let pct = number(TIER_TERMS.pct);
  if (pct !== null && nearest && Math.abs(nearest.pct - pct) > 1e-9) {
    note(TIER_TERMS.schedule, `The schedule's closest tier says ${asPercent(nearest.pct)}, and the top-tier percentage says ${asPercent(pct)}. The top-tier percentage is used.`);
  }
  if (pct === null && nearest && !conflicted.has(TIER_TERMS.pct)) {
    if (scheduleStates(nearest.pct)) {
      pct = nearest.pct;
      note(TIER_TERMS.pct, "The percentage was taken from the schedule's tier closest to arrival, whose quote states it.");
    } else {
      note(TIER_TERMS.schedule, "The schedule's quote doesn't state its closest tier's percentage, so the schedule can't stand in for the top-tier percentage.");
    }
  }

  const basis = choice(TIER_TERMS.charges);
  const charges = CHARGES_OF[basis ?? ""];
  const baseChoice = choice(TIER_TERMS.base);
  const base = BASE_OF[baseChoice ?? ""] ?? "other";

  if (pct === null) note(TIER_TERMS.pct, "No cancellation figure, because the reading gave no usable top-tier percentage.");
  if (!charges) {
    note(TIER_TERMS.charges, `No cancellation figure, because the reading didn't say whether the percentage is charged on the rate or on room profit (${basis ?? "not stated"}).`);
  }
  if (pct !== null && charges) {
    if (base === "other") {
      note(TIER_TERMS.base, `No cancellation figure, because the reading didn't say which room nights the percentage applies to (${baseChoice ?? "not stated"}).`);
    }
    figures.cancellation_tiers = [{ label: nearest?.label.trim() || "closest to arrival", room_pct: pct, base, charges }];
  }

  const answered: Record<string, boolean> = {
    [TIER_TERMS.pct]: pct !== null,
    [TIER_TERMS.charges]: basis !== null,
    [TIER_TERMS.base]: baseChoice !== null,
  };
  const cancellationRead = terms.stated.some((t) => Object.values(TIER_TERMS).includes(t.term_key));
  const unanswered = cancellationRead ? TIER_ANSWER_KEYS.filter((key) => !answered[key] && !conflicted.has(key)) : [];

  return { figures, notes, unanswered };
}

export const figuresFromTerms = (terms: ExtractedTerms): DealFigures => readFigures(terms).figures;

/**
 * What a review keeps of its reading: the figures, why any is missing, and
 * the exposure terms as the reader gave them.
 */
export function exposureReading(terms: ExtractedTerms, { figures, notes }: FigureReading = readFigures(terms)) {
  return {
    figures,
    notes,
    terms: terms.stated
      .filter((t) => EXPOSURE_TERM_KEYS.includes(t.term_key))
      .map(({ term_key, value, quoted_text, source_section, verification, confidence }) => ({
        term_key,
        value,
        quoted_text,
        source_section,
        verification,
        confidence,
      })),
    not_stated: terms.not_stated.filter((key) => EXPOSURE_TERM_KEYS.includes(key)),
  };
}
