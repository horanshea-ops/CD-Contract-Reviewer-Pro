import {
  collectHistoricalBatch,
  historicalRequest,
  sendHistoricalBatch,
  type AnalyzableDocument,
  type HistoricalBatchResult,
} from "../anthropic";
import { scanForAiUseTerms, type AiUseMatch } from "../ai-use-scan";
import { createAdminClient } from "../supabase/admin";
import { HOTEL_TERM_CATALOG } from "../terms/catalog";
import { extractionRecord, termRows } from "../terms/extract";
import { validateTerms } from "../terms/validate";
import { checkDetails, type DetailValues } from "./details";
import { BATCH_SIZE, HISTORICAL_BUCKET, type HistoricalContract, type StoredText } from "./types";

type Db = ReturnType<typeof createAdminClient>;

/** Wording that restricts AI-assisted review. A match holds the contract back until an admin decides. */
export function aiClauseMatches(text: StoredText): AiUseMatch[] {
  return scanForAiUseTerms(text.contract_parts.map((p) => p.text).join("\n"));
}

/**
 * Sends up to BATCH_SIZE waiting contracts to the Batch service. A PDF goes
 * as the file itself, so the model sees its layout; a Word file goes as text.
 */
export async function sendWaiting(db: Db, actorId: string): Promise<{ sent: number; remaining: number }> {
  const { data: waiting } = await db
    .from("historical_contracts")
    .select("id, source_format, storage_path, contract_text")
    .eq("extraction_status", "waiting")
    .order("created_at", { ascending: true })
    .limit(BATCH_SIZE);
  const rows = (waiting ?? []) as Pick<HistoricalContract & StoredText, "id" | "source_format" | "storage_path" | "contract_text">[];
  if (rows.length === 0) return { sent: 0, remaining: 0 };

  const requests = [];
  for (const row of rows) {
    let document: AnalyzableDocument;
    if (row.source_format === "pdf") {
      const { data: blob } = await db.storage.from(HISTORICAL_BUCKET).download(row.storage_path);
      if (!blob) continue;
      document = { kind: "pdf", pdfBase64: Buffer.from(await blob.arrayBuffer()).toString("base64") };
    } else {
      document = { kind: "text", text: row.contract_text };
    }
    requests.push({ custom_id: row.id, params: historicalRequest({ document, catalog: HOTEL_TERM_CATALOG }) });
  }

  const anthropicId = await sendHistoricalBatch(requests);
  const { data: batch } = await db
    .from("historical_batches")
    .insert({ anthropic_batch_id: anthropicId, sent_by: actorId, contract_count: requests.length, status: "in_progress" })
    .select("id")
    .single();
  const sentIds = requests.map((r) => r.custom_id);
  await db.from("historical_contracts").update({ extraction_status: "reading", batch_id: batch?.id ?? null }).in("id", sentIds);

  const { count } = await db
    .from("historical_contracts")
    .select("id", { count: "exact", head: true })
    .eq("extraction_status", "waiting");
  return { sent: requests.length, remaining: count ?? 0 };
}

/**
 * Stores one contract's reading. Details are checked against the contract's
 * words first, and only fill what an admin hasn't already filled in.
 */
export async function storeReading(
  db: Db,
  row: HistoricalContract & StoredText,
  result: HistoricalBatchResult,
  associates: { id: string; name: string }[]
) {
  if (!result.ok) {
    await db
      .from("historical_contracts")
      .update({ extraction_status: "failed", term_extraction: extractionRecord({ ok: false, error: result.error }) })
      .eq("id", row.id);
    return;
  }

  const { reading } = result;
  const details = checkDetails(reading.details, row.contract_parts, associates);
  const terms = validateTerms(reading.entries, HOTEL_TERM_CATALOG, row.contract_parts);

  await db.from("contract_terms").delete().eq("historical_contract_id", row.id);
  const inserted = await db.from("contract_terms").insert(termRows({ historical_contract_id: row.id }, terms));
  if (inserted.error) {
    await db
      .from("historical_contracts")
      .update({
        extraction_status: "failed",
        term_extraction: extractionRecord({ ok: false, error: `Terms were read but not saved: ${inserted.error.message}`, model_id: reading.model_id }),
      })
      .eq("id", row.id);
    return;
  }

  const fill: Partial<DetailValues> = {};
  const provenance: Record<string, string | undefined> = { ...(row.details_checked ?? {}) };
  for (const [field, value] of Object.entries(details.values) as [keyof DetailValues, string | null][]) {
    if (value === null || row[field] != null) continue;
    Object.assign(fill, { [field]: value });
    provenance[field] = details.checked[field]!;
  }

  await db
    .from("historical_contracts")
    .update({
      ...fill,
      details_checked: provenance,
      extraction_status: "done",
      term_extraction: {
        ...extractionRecord({
          ok: true,
          terms,
          model_id: reading.model_id,
          tokens: { input: reading.input_tokens, output: reading.output_tokens },
        }),
        details_dropped: details.dropped,
      },
    })
    .eq("id", row.id);
}

/** Stores the results of every batch that has ended. Batches still running are left alone. */
export async function collectEnded(db: Db): Promise<{ collected: number; stillReading: number }> {
  const { data: open } = await db.from("historical_batches").select("id, anthropic_batch_id").eq("status", "in_progress");
  const { data: associates } = await db.from("associates").select("id, name");
  let collected = 0;

  for (const batch of open ?? []) {
    const results = await collectHistoricalBatch(batch.anthropic_batch_id);
    if (!results) continue;

    const { data: rows } = await db.from("historical_contracts").select("*").eq("batch_id", batch.id).eq("extraction_status", "reading");
    const byId = new Map(((rows ?? []) as (HistoricalContract & StoredText)[]).map((r) => [r.id, r]));
    for (const result of results) {
      const row = byId.get(result.custom_id);
      if (!row) continue;
      await storeReading(db, row, result, associates ?? []);
      byId.delete(result.custom_id);
      collected++;
    }
    // A contract the batch returned nothing for is marked failed, so it can be sent again.
    for (const row of byId.values()) {
      await storeReading(db, row, { custom_id: row.id, ok: false, error: "The batch returned no result for it." }, []);
    }
    await db.from("historical_batches").update({ status: "ended", ended_at: new Date().toISOString() }).eq("id", batch.id);
  }

  const { count } = await db
    .from("historical_contracts")
    .select("id", { count: "exact", head: true })
    .eq("extraction_status", "reading");
  return { collected, stillReading: count ?? 0 };
}
