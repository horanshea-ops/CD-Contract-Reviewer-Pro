import { TIER_LABELS, type MarketTier } from "../analytics/types";
import type { DetailValues } from "./details";

const TEXT_FIELDS = ["hotel_name", "brand", "parent_company", "city", "state", "country", "client_name", "negotiated_by"] as const;
const DATE_FIELDS = ["signed_at", "event_start", "event_end"] as const;

const isIsoDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));

/**
 * An admin's corrections to a historical contract's details. Only the fields
 * sent change, and an empty one clears the detail.
 */
export function parseDetailEdits(body: Record<string, unknown>): { edits: Partial<DetailValues> } | { error: string } {
  const edits: Partial<DetailValues> = {};

  for (const field of TEXT_FIELDS) {
    if (!(field in body)) continue;
    const value = typeof body[field] === "string" ? (body[field] as string).trim() : "";
    edits[field] = value || null;
  }
  for (const field of DATE_FIELDS) {
    if (!(field in body)) continue;
    const value = typeof body[field] === "string" ? (body[field] as string).trim() : "";
    if (value && !isIsoDate(value)) return { error: "Enter dates as a full date." };
    edits[field] = value || null;
  }
  if ("market_tier" in body) {
    const tier = body.market_tier;
    if (tier !== null && tier !== "" && !(typeof tier === "string" && tier in TIER_LABELS)) return { error: "Choose a market tier." };
    edits.market_tier = (tier || null) as MarketTier | null;
  }

  const start = edits.event_start;
  const end = edits.event_end;
  if (start && end && end < start) return { error: "The event can't end before it starts." };
  if (Object.keys(edits).length === 0) return { error: "Nothing to change." };
  return { edits };
}
