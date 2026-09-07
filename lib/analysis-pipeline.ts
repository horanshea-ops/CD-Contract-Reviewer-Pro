import { createAdminClient } from "./supabase/admin";
import { analyzeContractPdf } from "./anthropic";
import { loadStandardsLibrary } from "./standards/load";
import { logAudit } from "./audit";
import { getPositionedLines } from "./get-positioned-lines";
import { findMatchingLineIndices } from "./locate-text";

const STORAGE_BUCKET = "contracts";

/**
 * Runs the actual analysis for one row in `analyses`, from "queued" through
 * "complete" or "failed". Called from the upload route via Next's after()
 * so the client gets its 202 response immediately and polls for status
 * (build brief §5) rather than holding a request open for 30-90+ seconds.
 */
export async function processAnalysis(analysisId: string) {
  const admin = createAdminClient();

  const { data: analysis, error: fetchError } = await admin
    .from("analyses")
    .select("id, storage_path, associate_id, source_format")
    .eq("id", analysisId)
    .single();

  if (fetchError || !analysis) {
    console.error(`processAnalysis: could not load analysis ${analysisId}`, fetchError);
    return;
  }

  await admin
    .from("analyses")
    .update({ status: "processing", started_at: new Date().toISOString() })
    .eq("id", analysisId);

  try {
    const { data: fileBlob, error: downloadError } = await admin.storage
      .from(STORAGE_BUCKET)
      .download(analysis.storage_path);

    if (downloadError || !fileBlob) {
      throw new Error(`Could not read uploaded file: ${downloadError?.message ?? "unknown error"}`);
    }

    const arrayBuffer = await fileBlob.arrayBuffer();
    const pdfBase64 = Buffer.from(arrayBuffer).toString("base64");

    // The database is the source of truth for the library, so admin edits
    // actually change how contracts are reviewed. A fallback to the bundled
    // copy is allowed (a transient database problem should not fail an
    // analysis) but is always recorded, never silent.
    const standards = await loadStandardsLibrary();
    if (standards.source === "bundled_fallback") {
      console.warn(
        `processAnalysis: ${analysisId} used the bundled standards library, not the database — ${standards.fallbackReason}`
      );
    }

    const result = await analyzeContractPdf({
      pdfBase64,
      standards: standards.entries,
      standardsVersion: standards.version,
    });

    if (result.findings.length > 0) {
      const findingRows = result.findings.map((f) => ({
        analysis_id: analysisId,
        clause_type: f.clause_type,
        is_missing_clause: f.is_missing_clause,
        severity: f.severity,
        exposure_amount: f.exposure_amount,
        exposure_basis: f.exposure_basis,
        location_section: f.location_section,
        quoted_text: f.quoted_text,
        finding_text: f.finding_text,
        cd_standard: f.cd_standard,
        proposed_language: f.proposed_language,
        model_confidence: f.model_confidence,
      }));

      const { data: insertedFindings, error: insertError } = await admin
        .from("findings")
        .insert(findingRows)
        .select("id, is_missing_clause, quoted_text");
      if (insertError) throw new Error(`Could not save findings: ${insertError.message}`);

      // Best-effort: precompute which findings can be located on the
      // rendered document, so the review screen can show that immediately
      // instead of only discovering it lazily at export time. A failure
      // here is a missed enhancement, not a failed analysis — it must never
      // flip an otherwise-successful analysis to "failed".
      try {
        const lines = await getPositionedLines({
          admin,
          associateId: analysis.associate_id,
          analysisId,
          sourceFormat: analysis.source_format,
          pdfBytes: new Uint8Array(arrayBuffer),
        });

        for (const finding of insertedFindings ?? []) {
          if (finding.is_missing_clause || !finding.quoted_text) continue;
          const matchedIndices = findMatchingLineIndices(lines, finding.quoted_text);
          if (!matchedIndices) continue;
          await admin
            .from("findings")
            .update({ location_page: lines[matchedIndices[0]].pageIndex + 1 })
            .eq("id", finding.id);
        }
      } catch (locateErr) {
        console.error(`processAnalysis: could not precompute finding locations for ${analysisId}`, locateErr);
      }
    }

    // Checked, unlike the status updates above: if this write fails the row
    // stays "processing" forever and the review screen polls an analysis that
    // silently never arrives — after the model call has already been paid for.
    // A pending migration is the likeliest cause, so surface it as a failure
    // the associate can see rather than a hang.
    const { error: completeError } = await admin
      .from("analyses")
      .update({
        status: "complete",
        completed_at: new Date().toISOString(),
        model_id: result.model_id,
        library_version: result.standards_library_version,
        standards_source: standards.source,
        standards_hash: standards.hash,
        token_usage: {
          input_tokens: result.input_tokens,
          output_tokens: result.output_tokens,
          cache_read_input_tokens: result.cache_read_input_tokens,
          cache_creation_input_tokens: result.cache_creation_input_tokens,
        },
      })
      .eq("id", analysisId);

    if (completeError) {
      throw new Error(
        `Analysis succeeded but could not be saved: ${completeError.message}. ` +
          `If this mentions an unknown column, a migration in supabase/migrations/ has not been applied.`
      );
    }

    await logAudit({
      actorId: analysis.associate_id,
      action: "analysis_complete",
      entityType: "analysis",
      entityId: analysisId,
      metadata: {
        findings_count: result.findings.length,
        clauses_checked: result.clauses_checked,
        standards_source: standards.source,
        standards_hash: standards.hash,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);

    await admin
      .from("analyses")
      .update({ status: "failed", completed_at: new Date().toISOString(), error: message })
      .eq("id", analysisId);

    await logAudit({
      actorId: analysis.associate_id,
      action: "analysis_failed",
      entityType: "analysis",
      entityId: analysisId,
      metadata: { error: message },
    });
  }
}
