import { logAudit } from "../audit";
import { getActionedFindings } from "../get-actioned-findings";
import { getPositionedLines } from "../get-positioned-lines";
import { generateCleanContractPdf, type CleanContractFinding } from "../clean-contract-pdf";
import { recordExport } from "../export-log";
import type { ExportContext } from "./context";
import type { ExportBuildResult, ExportRefusalResult } from "./types";
import { EXPORT_FORMAT_LABELS } from "./types";

const STORAGE_BUCKET = "contracts";

/**
 * §1.7.7 — the contract as it would read if the property agreed to every
 * accepted change. The marked-up PDF shows what changed; this shows the result.
 *
 * A document that fails its content check is refused rather than delivered. It
 * would look like a finished contract while missing text, which is the failure
 * §1.6.4 and §1.4.9 both guard against in their own paths. That refusal writes
 * no `exports` row, because no file was produced.
 */
export async function buildCleanContract(ctx: ExportContext): Promise<ExportBuildResult> {
  const { admin, associate, analysis, analysisId } = ctx;

  const { data: pdfBlob, error: pdfError } = await admin.storage
    .from(STORAGE_BUCKET)
    .download(analysis.storage_path);
  if (pdfError || !pdfBlob) {
    return refusal(500, { error: `Could not load the document: ${pdfError?.message}` });
  }

  let lines;
  try {
    lines = await getPositionedLines({
      admin,
      associateId: analysis.associate_id,
      analysisId,
      sourceFormat: analysis.source_format,
      pdfBytes: new Uint8Array(await pdfBlob.arrayBuffer()),
    });
  } catch (err) {
    return refusal(500, {
      error: err instanceof Error ? err.message : "Could not read this document's text.",
    });
  }

  // The allowlist boundary. getActionedFindings carries severity, finding_text
  // and cd_standard; this document can reach the property, so only contract
  // text crosses into it. Same rule as §1.8.3's property email.
  const { findings: actioned, nonSubstantive } = await getActionedFindings(admin, analysisId);
  const findings: CleanContractFinding[] = actioned.map((f) => ({
    clause_type: f.clause_type,
    location_section: f.location_section,
    quoted_text: f.quoted_text,
    language: f.language,
    is_missing_clause: f.is_missing_clause,
  }));

  if (findings.length === 0) {
    return refusal(400, {
      error: "No accepted changes, so this would just be the original contract.",
    });
  }

  // The property's own name where the analysis is linked to a thread, never the
  // filename — a CD filename can carry internal shorthand about the deal.
  let title = "Proposed Amended Contract";
  if (analysis.thread_id) {
    const { data: thread } = await admin
      .from("negotiation_threads")
      .select("property_name")
      .eq("id", analysis.thread_id)
      .maybeSingle();
    if (thread?.property_name) title = `Proposed Amended Contract — ${thread.property_name}`;
  }

  let result;
  try {
    result = await generateCleanContractPdf({ lines, findings, title });
  } catch (err) {
    return refusal(500, { error: err instanceof Error ? err.message : "Could not build the contract." });
  }

  const outcome = !result.conservation.ok ? "fallback" : result.unplaced.length ? "partial" : "clean";

  const preflight = {
    outcome,
    appliedCount: result.appliedCount,
    additions: result.additions.map((a) => ({ clause_type: a.clause_type })),
    unplaced: result.unplaced.map((u) => ({ clause_type: u.clause_type, reason: u.reason })),
    problems: result.conservation.problems,
    markupPdfUrl: `/api/analyses/${analysisId}/export-markup`,
  };

  if (!result.conservation.ok) {
    return {
      kind: "refusal",
      status: 409,
      body: {
        error: "The clean contract failed its content check and was not produced.",
        problems: result.conservation.problems,
      },
      preflight,
      summary:
        `${EXPORT_FORMAT_LABELS.clean}: the document failed its content check and was not produced. ` +
        `The marked-up PDF carries the same changes.`,
    };
  }

  return {
    kind: "file",
    filename: `proposed-contract-${analysisId.slice(0, 8)}.pdf`,
    contentType: "application/pdf",
    bytes: result.pdfBytes,
    outcome,
    preflight,
    commit: async () => {
      await recordExport(admin, {
        analysisId,
        associateId: associate.id,
        format: "pdf",
        outcome,
        findingsApplied: result.appliedCount,
        findingsUnapplied: result.unplaced.length,
        unappliedDetail: result.unplaced.length ? result.unplaced : null,
        analysisPaths: analysis,
      });

      await logAudit({
        actorId: associate.id,
        action: "clean_contract_exported",
        entityType: "analysis",
        entityId: analysisId,
        metadata: {
          applied: result.appliedCount,
          additions: result.additions.length,
          unplaced: result.unplaced.length,
          non_substantive: nonSubstantive.length,
          outcome,
          source_format: analysis.source_format,
        },
      });
    },
  };
}

function refusal(status: number, body: ExportRefusalResult["body"]): ExportRefusalResult {
  return {
    kind: "refusal",
    status,
    body,
    preflight: null,
    summary: `${EXPORT_FORMAT_LABELS.clean}: ${body.error}`,
  };
}
