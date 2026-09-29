import WordExtractor from "word-extractor";
import type { AnalyzableDocument } from "../anthropic";
import { scanForAiUseTerms } from "../ai-use-scan";
import { logAudit } from "../audit";
import { extractDocx } from "../docx";
import { contractText } from "../docx/contract-text";
import { extractPdfLines } from "../extract-pdf-lines";
import type { LocatablePart } from "../redline-engine/locate";
import { createAdminClient } from "../supabase/admin";
import { extractionRecord, extractTerms, termRows } from "../terms/extract";
import { HISTORICAL_BUCKET, historicalExtractionEnabled, type HistoricalContract } from "./types";

/** What the model reads, and the text its quotes are checked against. */
async function readContract(bytes: Uint8Array, format: HistoricalContract["source_format"]) {
  if (format === "docx") {
    const extracted = await extractDocx(bytes);
    const text = contractText(extracted);
    return { document: { kind: "text", text, pictures: extracted.pictures } as AnalyzableDocument, parts: extracted.parts, text };
  }
  if (format === "doc") {
    const doc = await new WordExtractor().extract(Buffer.from(bytes));
    const text = doc.getBody();
    return { document: { kind: "text", text } as AnalyzableDocument, parts: [{ part: "document", text }] as LocatablePart[], text };
  }
  const text = (await extractPdfLines(bytes.slice())).map((l) => l.text).join("\n");
  const pdfBase64 = Buffer.from(bytes).toString("base64");
  return { document: { kind: "pdf", pdfBase64 } as AnalyzableDocument, parts: [{ part: "document", text }] as LocatablePart[], text };
}

/**
 * Reads a historical contract's terms with the model and stores them.
 *
 * Nothing runs while HISTORICAL_EXTRACTION is off. A contract that restricts
 * AI-assisted review waits for an admin's decision, as a review does, unless
 * that admin has already chosen to go ahead.
 */
export async function extractHistoricalTerms(id: string, actorId: string, { aiClauseAcknowledged = false } = {}) {
  if (!historicalExtractionEnabled()) return;
  const db = createAdminClient();

  const { data: row } = await db.from("historical_contracts").select("*").eq("id", id).maybeSingle();
  if (!row) return;
  const contract = row as HistoricalContract;

  const fail = async (error: string, model_id?: string) => {
    await db
      .from("historical_contracts")
      .update({ extraction_status: "failed", term_extraction: extractionRecord({ ok: false, error, model_id }) })
      .eq("id", id);
  };

  try {
    const { data: blob, error: downloadError } = await db.storage.from(HISTORICAL_BUCKET).download(contract.storage_path);
    if (downloadError || !blob) return await fail(`Could not read the stored file: ${downloadError?.message ?? "missing"}`);

    const { document, parts, text } = await readContract(new Uint8Array(await blob.arrayBuffer()), contract.source_format);

    if (!aiClauseAcknowledged) {
      const matches = scanForAiUseTerms(text);
      if (matches.length > 0) {
        await db
          .from("historical_contracts")
          .update({ extraction_status: "blocked_ai_clause", term_extraction: { status: "blocked_ai_clause", matches } })
          .eq("id", id);
        await logAudit({
          actorId,
          action: "ai_clause_scan_blocked",
          entityType: "historical_contract",
          entityId: id,
          metadata: { matched_terms: matches.map((m) => m.term) },
        });
        return;
      }
    }

    const outcome = await extractTerms({ document, parts });
    await db.from("contract_terms").delete().eq("historical_contract_id", id);
    const inserted = await db.from("contract_terms").insert(termRows({ historical_contract_id: id }, outcome.terms));
    if (inserted.error) return await fail(`Terms were extracted but not saved: ${inserted.error.message}`, outcome.model_id);

    await db
      .from("historical_contracts")
      .update({ extraction_status: "done", term_extraction: extractionRecord({ ok: true, ...outcome }) })
      .eq("id", id);
  } catch (err) {
    await fail(err instanceof Error ? err.message : String(err));
  }
}
