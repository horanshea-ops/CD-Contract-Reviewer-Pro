import type { MarketTier } from "../analytics/types";

/** A signed contract from before the tool, uploaded by an admin. Mirrors migration 011. */
export interface HistoricalContract {
  id: string;
  uploaded_by: string;
  file_name: string;
  storage_path: string;
  source_format: "pdf" | "docx" | "doc";
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
  extraction_status: "stored" | "pending" | "done" | "failed" | "blocked_ai_clause";
  term_extraction: Record<string, unknown> | null;
  created_at: string;
}

export const HISTORICAL_BUCKET = "contracts";

/**
 * Real CD contracts may reach the model only once CD's own Anthropic org
 * exists (CLAUDE.md, deviation 7). Until then this stays off, and an upload
 * stores the file and its details without a model call.
 */
export function historicalExtractionEnabled(): boolean {
  return process.env.HISTORICAL_EXTRACTION === "on";
}
