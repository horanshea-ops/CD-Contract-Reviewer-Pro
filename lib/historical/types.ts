import type { MarketTier } from "../analytics/types";
import type { LocatablePart } from "../redline-engine/locate";
import type { Provenance } from "./details";

/** A signed contract from before the tool, uploaded by an admin. Mirrors migrations 011 and 012. */
export interface HistoricalContract {
  id: string;
  uploaded_by: string;
  file_name: string;
  storage_path: string;
  source_format: "pdf" | "docx" | "doc";
  file_sha256: string | null;
  hotel_name: string | null;
  brand: string | null;
  parent_company: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  market_tier: MarketTier | null;
  client_name: string | null;
  negotiated_by: string | null;
  event_start: string | null;
  event_end: string | null;
  signed_at: string | null;
  extraction_status: "stored" | "waiting" | "reading" | "pending" | "done" | "failed" | "blocked_ai_clause";
  term_extraction: Record<string, unknown> | null;
  details_checked: Partial<Record<string, Provenance | "edited">> | null;
  batch_id: string | null;
  created_at: string;
}

/** The columns the list screen needs. The contract's text stays on the server. */
export const LIST_COLUMNS =
  "id, uploaded_by, file_name, storage_path, source_format, file_sha256, hotel_name, brand, parent_company, city, state, country, market_tier, client_name, negotiated_by, event_start, event_end, signed_at, extraction_status, term_extraction, details_checked, batch_id, created_at";

export interface StoredText {
  contract_text: string;
  contract_parts: LocatablePart[];
}

export const HISTORICAL_BUCKET = "contracts";

/**
 * Historical uploads are archived for the beta (docs/archived-features.md).
 * Off, the screen and its routes answer "not found" and the Admin link opens
 * Users.
 */
export function historicalContractsEnabled(): boolean {
  return process.env.HISTORICAL_CONTRACTS === "on";
}

/**
 * Real CD contracts may reach the model only once CD's own Anthropic org
 * exists (CLAUDE.md, deviation 7). Until then this stays off, and uploads are
 * stored and wait.
 */
export function historicalExtractionEnabled(): boolean {
  return process.env.HISTORICAL_EXTRACTION === "on";
}

/** Contracts sent in one batch. Small enough to build and send within one request. */
export const BATCH_SIZE = 50;
