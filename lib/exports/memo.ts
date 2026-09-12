import { logAudit } from "../audit";
import { generateRevisionsMemo } from "../export-memo";
import { getActionedFindings } from "../get-actioned-findings";
import { recordExport } from "../export-log";
import type { ExportContext } from "./context";
import type { ExportBuildResult } from "./types";

/**
 * The requested-revisions memo — findings and CD's rationale, for internal
 * review. Generated from scratch, so no validation gate applies and the
 * outcome is always clean. The `exports` row is still written, so that table
 * records everything that left the building rather than redline attempts
 * alone (§1.6.5).
 */
export async function buildMemo(ctx: ExportContext): Promise<ExportBuildResult> {
  const { admin, associate, analysis, analysisId } = ctx;

  const { findings, nonSubstantive } = await getActionedFindings(admin, analysisId);

  const pdfBytes = await generateRevisionsMemo({
    contractFilename: analysis.filename,
    clientName: analysis.clients?.name ?? null,
    associateName: associate.name,
    findings,
  });

  return {
    kind: "file",
    filename: `requested-revisions-${analysisId.slice(0, 8)}.pdf`,
    contentType: "application/pdf",
    bytes: pdfBytes,
    outcome: "clean",
    preflight: null,
    commit: async () => {
      await recordExport(admin, {
        analysisId,
        associateId: associate.id,
        format: "memo",
        outcome: "clean",
        findingsApplied: findings.length,
        findingsUnapplied: 0,
        analysisPaths: analysis,
      });

      await logAudit({
        actorId: associate.id,
        action: "memo_exported",
        entityType: "analysis",
        entityId: analysisId,
        metadata: { findings_included: findings.length, non_substantive: nonSubstantive.length },
      });
    },
  };
}
