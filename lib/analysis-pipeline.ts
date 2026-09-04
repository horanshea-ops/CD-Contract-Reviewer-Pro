import { createAdminClient } from "./supabase/admin";
import { analyzeContractPdf } from "./anthropic";
import { logAudit } from "./audit";

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
    .select("id, storage_path, associate_id")
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

    const result = await analyzeContractPdf({ pdfBase64 });

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

      const { error: insertError } = await admin.from("findings").insert(findingRows);
      if (insertError) throw new Error(`Could not save findings: ${insertError.message}`);
    }

    await admin
      .from("analyses")
      .update({
        status: "complete",
        completed_at: new Date().toISOString(),
        model_id: result.model_id,
        library_version: result.standards_library_version,
        token_usage: {
          input_tokens: result.input_tokens,
          output_tokens: result.output_tokens,
          cache_read_input_tokens: result.cache_read_input_tokens,
          cache_creation_input_tokens: result.cache_creation_input_tokens,
        },
      })
      .eq("id", analysisId);

    await logAudit({
      actorId: analysis.associate_id,
      action: "analysis_complete",
      entityType: "analysis",
      entityId: analysisId,
      metadata: { findings_count: result.findings.length, clauses_checked: result.clauses_checked },
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
