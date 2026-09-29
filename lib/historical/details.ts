import { TIER_LABELS, type MarketTier } from "../analytics/types";
import type { LocatablePart } from "../redline-engine/locate";
import { quoteFound } from "../terms/validate";

/**
 * Checks the details the model read from a historical contract before any are
 * stored. A stated detail is kept only when its quote is in the contract. Parent
 * company and market tier come from what the model knows of the brand, so they
 * are kept as guesses, marked so an admin can tell the difference.
 */

export type Provenance = "checked" | "guessed";

export interface DetailValues {
  hotel_name: string | null;
  brand: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  client_name: string | null;
  signed_at: string | null;
  event_start: string | null;
  event_end: string | null;
  negotiated_by: string | null;
  parent_company: string | null;
  market_tier: MarketTier | null;
}

export interface CheckedDetails {
  values: DetailValues;
  /** How each filled detail was arrived at. */
  checked: Partial<Record<keyof DetailValues, Provenance>>;
  /** Details the model gave that failed their check, and why. */
  dropped: { field: keyof DetailValues; reason: string }[];
}

/** The model's key for each stated detail, and the column it fills. */
type StatedField = Exclude<keyof DetailValues, "parent_company" | "market_tier">;

const STATED: [string, StatedField][] = [
  ["hotel_name", "hotel_name"],
  ["brand", "brand"],
  ["city", "city"],
  ["state", "state"],
  ["country", "country"],
  ["client_name", "client_name"],
  ["signed_date", "signed_at"],
  ["event_start", "event_start"],
  ["event_end", "event_end"],
  ["negotiated_by", "negotiated_by"],
];

const DATES = new Set<keyof DetailValues>(["signed_at", "event_start", "event_end"]);

const UNITED_STATES = /^(u\.?s\.?a?\.?|united states( of america)?|america)$/i;

const person = (s: string) => s.toLowerCase().replace(/[^a-z]+/g, " ").trim();

function isIsoDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

export function checkDetails(raw: Record<string, unknown>, parts: LocatablePart[], associates: { id: string; name: string }[]): CheckedDetails {
  const values: DetailValues = {
    hotel_name: null,
    brand: null,
    city: null,
    state: null,
    country: null,
    client_name: null,
    signed_at: null,
    event_start: null,
    event_end: null,
    negotiated_by: null,
    parent_company: null,
    market_tier: null,
  };
  const checked: CheckedDetails["checked"] = {};
  const dropped: CheckedDetails["dropped"] = [];

  for (const [key, field] of STATED) {
    const detail = raw[key] as { value?: unknown; quoted_text?: unknown } | null | undefined;
    if (!detail) continue;
    const value = typeof detail.value === "string" ? detail.value.trim() : "";
    const quote = typeof detail.quoted_text === "string" ? detail.quoted_text.trim() : "";
    if (!value) continue;
    if (!quote || !quoteFound(parts, quote, null)) {
      dropped.push({ field, reason: "Its quoted words aren't in the contract." });
      continue;
    }
    if (DATES.has(field) && !isIsoDate(value)) {
      dropped.push({ field, reason: `"${value}" isn't a date.` });
      continue;
    }

    let stored = value;
    if (field === "country" && UNITED_STATES.test(value)) stored = "United States";
    if (field === "state" && /^[a-z]{2}$/i.test(value)) stored = value.toUpperCase();
    if (field === "negotiated_by") {
      const matches = associates.filter((a) => person(a.name) === person(value));
      if (matches.length !== 1) {
        dropped.push({ field, reason: `"${value}" doesn't match one associate.` });
        continue;
      }
      stored = matches[0].id;
    }

    values[field] = stored;
    checked[field] = "checked";
  }

  if (values.event_start && values.event_end && values.event_end < values.event_start) {
    dropped.push({ field: "event_end", reason: "It falls before the event starts." });
    values.event_end = null;
    delete checked.event_end;
  }

  if (typeof raw.parent_company === "string" && raw.parent_company.trim()) {
    values.parent_company = raw.parent_company.trim();
    checked.parent_company = "guessed";
  }
  if (typeof raw.market_tier === "string" && raw.market_tier in TIER_LABELS) {
    values.market_tier = raw.market_tier as MarketTier;
    checked.market_tier = "guessed";
  }

  return { values, checked, dropped };
}

/** Analytics needs these before a contract counts. A contract naming no brand counts as independent. */
export const REQUIRED_DETAILS = ["hotel_name", "city", "signed_at", "market_tier"] as const;

export function needsALook(row: Pick<DetailValues, (typeof REQUIRED_DETAILS)[number]>): boolean {
  return REQUIRED_DETAILS.some((field) => !row[field]);
}
