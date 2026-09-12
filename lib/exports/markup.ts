import { logAudit } from "../audit";
import { getActionedFindings } from "../get-actioned-findings";
import { generateMarkupPdf } from "../redline-pdf";
import { getPositionedLines } from "../get-positioned-lines";
import { recordExport } from "../export-log";
import type { ExportContext } from "./context";
import type { ExportBuildResult } from "./types";
import { EXPORT_FORMAT_LABELS } from "./types";

const STORAGE_BUCKET = "contracts";

/**
 * The marked-up PDF — strikethrough and numbered margin markers on the
 * document itself, with detail in an appendix. Every source format reaches it.
 * DOCX/DOC-sourced analyses use the line positions recorded when we rendered
 * that PDF; PDF-sourced ones use real text extraction.
 *
 * Drawn on a PDF rather than injected into Word, so §1.6.1 and §1.6.2 have
 * nothing to check and the outcome is always clean (§1.6.5).
 */
export async function buildMarkup(ctx: ExportContext): Promise<ExportBuildResult> {
  const { admin, associate, analysis, analysisId } = ctx;

  const { data: pdfBlob, error: pdfError } = await admin.storage
    .from(STORAGE_BUCKET)
    .download(analysis.storage_path);
  if (pdfError || !pdfBlob) {
    return refusal(500, `Could not load the document: ${pdfError?.message}`);
  }
  const pdfBytes = new Uint8Array(await pdfBlob.arrayBuffer());

  let lines;
  try {
    lines = await getPositionedLines({
      admin,
      associateId: analysis.associate_id,
      analysisId,
      sourceFormat: analysis.source_format,
      pdfBytes,
    });
  } catch (err) {
    return refusal(500, err instanceof Error ? err.message : "Could not read this document's text.");
  }

  const { findings, nonSubstantive } = await getActionedFindings(admin, analysisId);
  const markupBytes = await generateMarkupPdf({ pdfBytes, lines, findings });

  return {
    kind: "file",
    filename: `marked-up-${analysisId.slice(0, 8)}.pdf`,
    contentType: "application/pdf",
    bytes: markupBytes,
    outcome: "clean",
    preflight: null,
    commit: async () => {
      await recordExport(admin, {
        analysisId,
        associateId: associate.id,
        format: "pdf",
        outcome: "clean",
        findingsApplied: findings.length,
        findingsUnapplied: 0,
        analysisPaths: analysis,
      });

      await logAudit({
        actorId: associate.id,
        action: "markup_exported",
        entityType: "analysis",
        entityId: analysisId,
        metadata: {
          findings_included: findings.length,
          non_substantive: nonSubstantive.length,
          source_format: analysis.source_format,
        },
      });
    },
  };
}

function refusal(status: number, error: string): ExportBuildResult {
  return {
    kind: "refusal",
    status,
    body: { error },
    preflight: null,
    summary: `${EXPORT_FORMAT_LABELS.markup}: ${error}`,
  };
}
