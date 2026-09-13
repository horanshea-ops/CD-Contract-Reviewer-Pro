import { logAudit } from "../audit";
import { getActionedFindings } from "../get-actioned-findings";
import { generateMarkupPdf } from "../redline-pdf";
import { recordExport } from "../export-log";
import type { ExportContext } from "./context";
import { positionedLinesFor } from "./positioned-lines";
import type { ExportBuildResult } from "./types";

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

  const source = await positionedLinesFor(ctx);
  if (!source.ok) {
    return refusal(source.error, "The marked-up PDF was not exported. The document could not be read.");
  }
  const { lines, pdfBytes } = source;

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

function refusal(error: string, summary: string): ExportBuildResult {
  return { kind: "refusal", status: 500, body: { error }, preflight: null, summary };
}
