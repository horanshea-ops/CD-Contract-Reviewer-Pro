import { logAudit } from "../audit";
import { getActionedFindings } from "../get-actioned-findings";
import { generateMarkupPdf } from "../redline-pdf";
import { recordExport } from "../export-log";
import type { ExportContext } from "./context";
import { positionedLinesFor } from "./positioned-lines";
import { buildStructuredContract } from "./structured";
import type { ExportBuildResult } from "./types";

/**
 * The marked-up PDF. Every source format reaches it, in one of two layouts.
 *
 *   structured  a Word upload with an editable file. Drawn from the tracked-
 *               changes DOCX with its headings, lists and tables, deletions
 *               struck in red and insertions underlined in blue, in place.
 *   overlay     everything else. Strikethrough and numbered margin markers on
 *               the stored PDF, with the new wording on a cover page. PDF
 *               uploads keep their own look this way.
 *
 * A structured file that fails its read-back check falls back to the overlay,
 * which carries the same changes.
 */
export async function buildMarkup(ctx: ExportContext): Promise<ExportBuildResult> {
  const { admin, associate, analysis, analysisId } = ctx;

  const structured = await buildStructuredContract(ctx, "markup");
  if (structured && structured.problems.length === 0) {
    const { engineResult, nonSubstantive } = structured.redline;
    return {
      kind: "file",
      filename: `marked-up-${analysisId.slice(0, 8)}.pdf`,
      contentType: "application/pdf",
      bytes: structured.pdfBytes,
      outcome: "clean",
      preflight: null,
      commit: async () => {
        await recordExport(admin, {
          analysisId,
          associateId: associate.id,
          format: "pdf",
          outcome: "clean",
          findingsApplied: engineResult.appliedCount,
          findingsUnapplied: 0,
          analysisPaths: analysis,
        });
        await logAudit({
          actorId: associate.id,
          action: "markup_exported",
          entityType: "analysis",
          entityId: analysisId,
          metadata: {
            findings_included: engineResult.appliedCount + structured.unplaced.length,
            listed_after_contract: structured.unplaced.length,
            non_substantive: nonSubstantive.length,
            source_format: analysis.source_format,
            layout: "structured",
          },
        });
      },
    };
  }

  const source = await positionedLinesFor(ctx);
  if (!source.ok) {
    return refusal(source.error, "The marked-up PDF was not exported. The document could not be read.");
  }
  const { lines, pdfBytes } = source;

  const actioned = await getActionedFindings(admin, analysisId);
  const { nonSubstantive } = actioned;
  // A point raised without wording has nothing to mark up.
  const findings = actioned.findings.filter((f) => f.language.trim());
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
          layout: "overlay",
          structured_problems: structured?.problems.length ? structured.problems : undefined,
        },
      });
    },
  };
}

function refusal(error: string, summary: string): ExportBuildResult {
  return { kind: "refusal", status: 500, body: { error }, preflight: null, summary };
}
