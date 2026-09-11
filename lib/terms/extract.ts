import { extractContractTerms, type AnalyzableDocument } from "../anthropic";
import type { LocatablePart } from "../redline-engine/locate";
import { HOTEL_TERM_CATALOG, catalogIndex } from "./catalog";
import type { ExtractedTerms, TermCatalog, Verification } from "./types";
import { validateTerms } from "./validate";

/**
 * One extraction pass: ask the model, then validate and verify what it said
 * against the same document (MASTER_PLAN.md §2.0.2).
 *
 * `parts` must be the text the model read, split the way the locator expects —
 * a DOCX's extracted parts, or a PDF's positioned lines joined as one part.
 * Verifying against different text from what was read would mark sound quotes
 * as unlocated.
 */
export async function extractTerms({
  document,
  parts,
  catalog = HOTEL_TERM_CATALOG,
  model,
}: {
  document: AnalyzableDocument;
  parts: LocatablePart[];
  catalog?: TermCatalog;
  model?: string;
}) {
  const response = await extractContractTerms({ document, catalog, model });
  return {
    terms: validateTerms(response.entries, catalog, parts),
    model_id: response.model_id,
    tokens: {
      input: response.input_tokens,
      output: response.output_tokens,
      cache_read: response.cache_read_input_tokens,
      cache_creation: response.cache_creation_input_tokens,
    },
  };
}

/** A `contract_terms` row. Mirrors supabase/migrations/006_contract_terms.sql. */
export interface ContractTermRow {
  analysis_id: string;
  term_key: string;
  status: "stated" | "not_stated";
  term_value: unknown;
  unit: string | null;
  source_section: string | null;
  quoted_text: string | null;
  verification: Verification | null;
  confidence: string | null;
  catalog_version: string;
}

/** Every catalog key gets a row, so "this contract has no cutoff date" is a query, not an absence. */
export function termRows(analysisId: string, terms: ExtractedTerms, catalog: TermCatalog = HOTEL_TERM_CATALOG): ContractTermRow[] {
  const index = catalogIndex(catalog);
  const stated: ContractTermRow[] = terms.stated.map((t) => ({
    analysis_id: analysisId,
    term_key: t.term_key,
    status: "stated",
    term_value: t.value,
    unit: t.unit,
    source_section: t.source_section,
    quoted_text: t.quoted_text,
    verification: t.verification,
    confidence: t.confidence,
    catalog_version: terms.catalog_version,
  }));
  const notStated: ContractTermRow[] = terms.not_stated.map((key) => {
    const def = index.get(key);
    return {
      analysis_id: analysisId,
      term_key: key,
      status: "not_stated",
      term_value: null,
      unit: def?.kind === "number" ? def.unit! : def?.kind === "schedule" ? "pct" : null,
      source_section: null,
      quoted_text: null,
      verification: null,
      confidence: null,
      catalog_version: terms.catalog_version,
    };
  });
  return [...stated, ...notStated];
}

/** What `analyses.term_extraction` records about a pass, whether it worked or not. */
export function extractionRecord(
  outcome:
    | { ok: true; terms: ExtractedTerms; model_id: string; tokens: Record<string, number> }
    | { ok: false; error: string; model_id?: string }
) {
  const extracted_at = new Date().toISOString();
  if (!outcome.ok) return { status: "failed", error: outcome.error, model_id: outcome.model_id ?? null, extracted_at };

  const verification: Record<Verification, number> = { verified: 0, located: 0, contradicted: 0, unlocated: 0 };
  for (const t of outcome.terms.stated) verification[t.verification] += 1;

  return {
    status: "complete",
    model_id: outcome.model_id,
    catalog_version: outcome.terms.catalog_version,
    extracted_at,
    stated: outcome.terms.stated.length,
    not_stated: outcome.terms.not_stated.length,
    verification,
    conflicts: outcome.terms.conflicts,
    rejected: outcome.terms.rejected,
    tokens: outcome.tokens,
  };
}
