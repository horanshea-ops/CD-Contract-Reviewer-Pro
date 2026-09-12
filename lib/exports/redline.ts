import { logAudit } from "../audit";
import { getActionedFindings } from "../get-actioned-findings";
import { generateRedline } from "../redline-engine";
import { UNAPPLIED_REASON_TEXT, validateRedline } from "../redline-validation";
import { recordExport, recordResolutions } from "../export-log";
import type { ExportContext } from "./context";
import type { ExportBuildResult, ExportRefusalResult } from "./types";
import { EXPORT_FORMAT_LABELS } from "./types";

const STORAGE_BUCKET = "contracts";

/**
 * The tracked-changes DOCX — real Word `w:ins`/`w:del` revision marks on the
 * uploaded document. DOCX-sourced analyses only; there is no Word document to
 * inject revisions into for a PDF- or DOC-sourced one (docs/redline-export-plan.md).
 *
 * Nothing is delivered until the oracle has passed it (§1.6). Three outcomes,
 * never all-or-nothing:
 *
 *   clean     every finding applied, validation passed — deliver the .docx
 *   partial   some refused, validation passed — deliver it, with the list
 *   fallback  validation failed — discard the file, route to the marked-up PDF
 *
 * A fallback still records its `exports` row, so §1.6.6's degradation rate
 * counts the attempt.
 */
export async function buildRedline(ctx: ExportContext): Promise<ExportBuildResult> {
  const { admin, associate, analysis, analysisId } = ctx;
  const markupPdfUrl = `/api/analyses/${analysisId}/export-markup`;

  if (analysis.source_format !== "docx" || !analysis.original_storage_path) {
    return refusal(400, {
      error: "Tracked-changes export is only available for contracts uploaded as DOCX.",
    });
  }

  // §1.4.9 decided at upload that this document could not be safely edited, and
  // the associate was told so before they reviewed anything. Honour that here
  // rather than editing it anyway and leaning on §1.6 to catch the damage.
  if (analysis.intake_route === "pdf") {
    return refusal(400, {
      error:
        "This document could not be read cleanly enough to edit, so it takes the PDF path. " +
        "Use the marked-up PDF export instead.",
      markupPdfUrl,
    });
  }

  const { data: originalBlob, error: downloadError } = await admin.storage
    .from(STORAGE_BUCKET)
    .download(analysis.original_storage_path);
  if (downloadError || !originalBlob) {
    return refusal(500, { error: `Could not load the original document: ${downloadError?.message}` });
  }

  const { findings, nonSubstantive } = await getActionedFindings(admin, analysisId);
  const originalBytes = new Uint8Array(await originalBlob.arrayBuffer());

  let engineResult;
  try {
    engineResult = await generateRedline({
      originalDocxBytes: originalBytes,
      findings,
      author: associate.name,
    });
  } catch (err) {
    return refusal(500, {
      error: err instanceof Error ? err.message : "Could not generate tracked changes.",
    });
  }

  const report = await validateRedline({ originalBytes, engineResult, author: associate.name });
  const unapplied = report.unapplied.map((u) => ({ ...u, explanation: UNAPPLIED_REASON_TEXT[u.reason] }));

  const preflight = {
    outcome: report.outcome,
    appliedCount: report.appliedCount,
    unapplied,
    fallbackReason: report.fallbackReason,
    markupPdfUrl,
  };

  const commit = async () => {
    await recordResolutions(admin, engineResult.resolutions);

    await recordExport(admin, {
      analysisId,
      associateId: associate.id,
      format: "docx",
      outcome: report.outcome,
      fallbackReason: report.fallbackReason,
      findingsApplied: report.appliedCount,
      findingsUnapplied: report.unapplied.length,
      unappliedDetail: report.unapplied.length ? report.unapplied : null,
      analysisPaths: analysis,
    });

    await logAudit({
      actorId: associate.id,
      action: "redline_docx_exported",
      entityType: "analysis",
      entityId: analysisId,
      metadata: {
        non_substantive: nonSubstantive.length,
        outcome: report.outcome,
        matched: report.appliedCount,
        unmatched: report.unapplied.length,
        fallback_reason: report.fallbackReason,
      },
    });
  };

  // §1.6.4 — discard the output entirely rather than hand over a file that
  // might not open. The marked-up PDF carries the same findings.
  if (report.outcome === "fallback") {
    return {
      kind: "refusal",
      status: 409,
      body: {
        error: "The marked-up Word file did not pass validation, so it was discarded.",
        outcome: report.outcome,
        fallbackReason: report.fallbackReason,
        markupPdfUrl,
      },
      preflight,
      summary:
        `${EXPORT_FORMAT_LABELS.redline}: the file did not pass validation and was discarded. ` +
        `The marked-up PDF carries the same findings.`,
      commit,
    };
  }

  return {
    kind: "file",
    filename: analysis.filename.replace(/\.docx$/i, "") + "-redline.docx",
    contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    bytes: engineResult.docxBytes,
    outcome: report.outcome,
    preflight,
    extraHeaders: { "X-Export-Outcome": report.outcome },
    commit,
  };
}

function refusal(status: number, body: ExportRefusalResult["body"]): ExportRefusalResult {
  return {
    kind: "refusal",
    status,
    body,
    preflight: null,
    summary: `${EXPORT_FORMAT_LABELS.redline}: ${body.error}`,
  };
}
