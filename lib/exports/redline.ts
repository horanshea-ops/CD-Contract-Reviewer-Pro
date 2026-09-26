import { logAudit } from "../audit";
import { getActionedFindings, type NonSubstantiveFinding } from "../get-actioned-findings";
import { generateRedline, type RedlineOutcome, type RevisionFinding } from "../redline-engine";
import { UNAPPLIED_REASON_TEXT, validateRedline, type ValidationReport } from "../redline-validation";
import { recordExport, recordResolutions } from "../export-log";
import { storeSentFile } from "./sent-file";
import type { ExportContext } from "./context";
import { cachedBuild, fingerprint } from "./build-cache";
import type { ExportBuildResult, ExportRefusalResult } from "./types";

const STORAGE_BUCKET = "contracts";
const DOCX_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

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
export interface LoadedRedline {
  engineResult: RedlineOutcome;
  report: ValidationReport;
  findings: RevisionFinding[];
  nonSubstantive: NonSubstantiveFinding[];
}

/** A Word upload that passed the upload check, so its own file can carry the changes. */
export function hasEditableWordFile(analysis: ExportContext["analysis"]): boolean {
  return analysis.source_format === "docx" && analysis.intake_route !== "pdf" && !!analysis.original_storage_path;
}

/**
 * The engine run and its §1.6 verdict, shared by every export built from the
 * tracked-changes file: this one, both PDFs and the clean Word copy. Cached, so
 * one click that asks for several of them runs the engine once.
 */
export async function loadRedline(
  ctx: ExportContext
): Promise<{ ok: true; redline: LoadedRedline } | { ok: false; refusal: ExportRefusalResult }> {
  const { admin, associate, analysis, analysisId } = ctx;
  const markupPdfUrl = `/api/analyses/${analysisId}/export-markup`;

  if (analysis.source_format !== "docx" || !analysis.original_storage_path) {
    return fail(
      400,
      { error: "Tracked-changes export is only available for contracts uploaded as DOCX." },
      "Tracked-changes DOCX was not exported. This contract was uploaded as a PDF, so there is no Word file to mark up."
    );
  }

  // §1.4.9 decided at upload that this document could not be safely edited, and
  // the associate was told so before they reviewed anything. Honour that here
  // rather than editing it anyway and leaning on §1.6 to catch the damage.
  if (analysis.intake_route === "pdf") {
    return fail(
      400,
      {
        error:
          "This document could not be read cleanly enough to edit, so it takes the PDF path. " +
          "Use the marked-up PDF export instead.",
        markupPdfUrl,
      },
      "Tracked-changes DOCX was not exported. This Word file could not be read cleanly enough to edit, so it takes the PDF path."
    );
  }

  const { data: originalBlob, error: downloadError } = await admin.storage
    .from(STORAGE_BUCKET)
    .download(analysis.original_storage_path);
  if (downloadError || !originalBlob) {
    return fail(
      500,
      { error: `Could not load the original document: ${downloadError?.message}` },
      "Tracked-changes DOCX was not exported. The original document could not be loaded."
    );
  }

  const { findings, nonSubstantive } = await getActionedFindings(admin, analysisId);
  const originalBytes = new Uint8Array(await originalBlob.arrayBuffer());

  // The dialog preflights this format before it downloads it, so without the
  // cache the engine and the oracle both run twice for one click.
  let built;
  try {
    built = await cachedBuild(
      `${associate.id}:${analysisId}:redline`,
      fingerprint([analysis.original_storage_path, associate.name, findings]),
      async () => {
        const engineResult = await generateRedline({
          originalDocxBytes: originalBytes,
          findings,
          author: associate.name,
        });
        const report = await validateRedline({ originalBytes, engineResult, author: associate.name });
        return { engineResult, report };
      }
    );
  } catch (err) {
    return fail(
      500,
      { error: err instanceof Error ? err.message : "Could not generate tracked changes." },
      "Tracked-changes DOCX was not exported. The tracked changes could not be generated."
    );
  }

  return { ok: true, redline: { ...built, findings, nonSubstantive } };
}

export async function buildRedline(ctx: ExportContext): Promise<ExportBuildResult> {
  const { admin, associate, analysis, analysisId } = ctx;
  const markupPdfUrl = `/api/analyses/${analysisId}/export-markup`;

  const loaded = await loadRedline(ctx);
  if (!loaded.ok) return loaded.refusal;
  const { engineResult, report, nonSubstantive } = loaded.redline;
  const unapplied = report.unapplied.map((u) => ({ ...u, explanation: UNAPPLIED_REASON_TEXT[u.reason] }));

  const preflight = {
    outcome: report.outcome,
    appliedCount: report.appliedCount,
    unapplied,
    widened: report.widened,
    fallbackReason: report.fallbackReason,
    markupPdfUrl,
  };

  const filename = analysis.filename.replace(/\.docx$/i, "") + "-redline.docx";

  const commit = async () => {
    await recordResolutions(admin, engineResult.resolutions);

    // §1.9.4 — keep what we sent, for the round that comes back. A discarded
    // fallback was never sent, so there is nothing to keep.
    const storagePath =
      report.outcome === "fallback"
        ? null
        : await storeSentFile(admin, {
            associateId: associate.id,
            analysisId,
            filename,
            bytes: engineResult.docxBytes,
            contentType: DOCX_CONTENT_TYPE,
          });

    await recordExport(admin, {
      analysisId,
      associateId: associate.id,
      format: "docx",
      outcome: report.outcome,
      fallbackReason: report.fallbackReason,
      findingsApplied: report.appliedCount,
      findingsUnapplied: report.unapplied.length,
      unappliedDetail: report.unapplied.length ? report.unapplied : null,
      storagePath,
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
        "Tracked-changes DOCX was not exported. The file did not pass validation and was discarded. " +
        "The marked-up PDF carries the same findings.",
      commit,
    };
  }

  return {
    kind: "file",
    filename,
    contentType: DOCX_CONTENT_TYPE,
    bytes: engineResult.docxBytes,
    outcome: report.outcome,
    preflight,
    extraHeaders: { "X-Export-Outcome": report.outcome },
    commit,
  };
}

function fail(
  status: number,
  body: ExportRefusalResult["body"],
  summary: string
): { ok: false; refusal: ExportRefusalResult } {
  return { ok: false, refusal: refusal(status, body, summary) };
}

function refusal(
  status: number,
  body: ExportRefusalResult["body"],
  summary: string
): ExportRefusalResult {
  return { kind: "refusal", status, body, preflight: null, summary };
}
