import { TIER_LABELS, type MarketTier } from "../analytics/types";

/** The details an admin enters for a historical contract, checked before anything is stored. */
export interface HistoricalDetails {
  hotel_name: string;
  brand: string;
  parent_company: string | null;
  city: string;
  state: string;
  country: string;
  market_tier: MarketTier;
  client_name: string;
  negotiated_by: string | null;
  event_start: string | null;
  event_end: string | null;
  signed_at: string;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function text(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value.trim() : "";
}

function date(form: FormData, name: string): string | null {
  const value = text(form, name);
  return ISO_DATE.test(value) && !Number.isNaN(Date.parse(value)) ? value : null;
}

/** The details, or the first thing wrong with them in words an admin can act on. */
export function parseHistoricalDetails(form: FormData): { details: HistoricalDetails } | { error: string } {
  const required: [keyof HistoricalDetails, string][] = [
    ["hotel_name", "Enter the hotel's name."],
    ["brand", "Enter the brand."],
    ["city", "Enter the city."],
    ["client_name", "Enter the client."],
  ];
  for (const [field, error] of required) if (!text(form, field)) return { error };

  const tier = text(form, "market_tier");
  if (!(tier in TIER_LABELS)) return { error: "Choose a market tier." };

  const signed_at = date(form, "signed_at");
  if (!signed_at) return { error: "Enter the date the contract was signed." };

  const event_start = date(form, "event_start");
  const event_end = date(form, "event_end");
  if (event_start && event_end && event_end < event_start) return { error: "The event can't end before it starts." };

  return {
    details: {
      hotel_name: text(form, "hotel_name"),
      brand: text(form, "brand"),
      parent_company: text(form, "parent_company") || null,
      city: text(form, "city"),
      state: text(form, "state"),
      country: text(form, "country") || "United States",
      market_tier: tier as MarketTier,
      client_name: text(form, "client_name"),
      negotiated_by: text(form, "negotiated_by") || null,
      event_start,
      event_end,
      signed_at,
    },
  };
}
