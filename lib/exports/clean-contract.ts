import { logAudit } from "../audit";
import { getActionedFindings } from "../get-actioned-findings";
import { generateCleanContractPdf, type CleanContractFinding } from "../clean-contract-pdf";
import { recordExport } from "../export-log";
import type { ExportContext } from "./context";
import { positionedLinesFor } from "./positioned-lines";
import { buildStructuredContract, type StructuredContract } from "./structured";
import { cachedBuild, fingerprint } from "./build-cache";
import type { ExportBuildResult, ExportRefusalResult } from "./types";

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
  const structured = await buildStructuredContract(ctx, "clean");
  if (structured) return fromStructured(ctx, structured);
  return fromStoredText(ctx);
}

/**
 * A Word upload with an editable file: the tracked-changes DOCX with every
 * change accepted, drawn with its headings, lists and tables.
 */
async function fromStructured(ctx: ExportContext, structured: StructuredContract): Promise<ExportBuildResult> {
  const { admin, associate, analysis, analysisId } = ctx;
  const { engineResult, findings, nonSubstantive } = structured.redline;

  if (!findings.some((f) => f.language.trim())) return noChanges();

  const refused = new Set(engineResult.unappliedIds);
  const additions = findings
    .filter((f) => f.is_missing_clause && f.language.trim() && !refused.has(f.id))
    .map((f) => ({ clause_type: f.clause_type }));
  const outcome = structured.unplaced.length ? "partial" : "clean";
  const markupPdfUrl = `/api/analyses/${analysisId}/export-markup`;

  const preflight = {
    outcome: structured.problems.length ? "fallback" : outcome,
    appliedCount: engineResult.appliedCount,
    additions,
    unplaced: structured.unplaced,
    problems: structured.problems,
    markupPdfUrl,
  };

  if (structured.problems.length) {
    return {
      kind: "refusal",
      status: 409,
      body: { error: "The clean contract failed its content check and was not produced.", problems: structured.problems },
      preflight,
      summary:
        "The proposed contract was not exported. It failed its content check and was discarded. " +
        "The marked-up PDF carries the same changes.",
    };
  }

  return {
    kind: "file",
    filename: `proposed-contract-${analysisId.slice(0, 8)}.pdf`,
    contentType: "application/pdf",
    bytes: structured.pdfBytes,
    outcome,
    preflight,
    commit: async () => {
      await recordExport(admin, {
        analysisId,
        associateId: associate.id,
        format: "pdf",
        outcome,
        findingsApplied: engineResult.appliedCount,
        findingsUnapplied: structured.unplaced.length,
        unappliedDetail: structured.unplaced.length ? structured.unplaced : null,
        analysisPaths: analysis,
      });

      await logAudit({
        actorId: associate.id,
        action: "clean_contract_exported",
        entityType: "analysis",
        entityId: analysisId,
        metadata: {
          applied: engineResult.appliedCount,
          additions: additions.length,
          unplaced: structured.unplaced.length,
          non_substantive: nonSubstantive.length,
          outcome,
          source_format: analysis.source_format,
          layout: "structured",
        },
      });
    },
  };
}

function noChanges(): ExportRefusalResult {
  return refusal(
    400,
    { error: "No accepted changes, so this would just be the original contract." },
    "The proposed contract was not exported. There are no accepted changes, so it would just be the original contract."
  );
}

/** Everything else: the text read at upload, with the changes spliced in. */
async function fromStoredText(ctx: ExportContext): Promise<ExportBuildResult> {
  const { admin, associate, analysis, analysisId } = ctx;

  const source = await positionedLinesFor(ctx);
  if (!source.ok) {
    return refusal(
      500,
      { error: source.error },
      "The proposed contract was not exported. The document could not be read."
    );
  }
  const { lines } = source;

  // The allowlist boundary. getActionedFindings carries severity, finding_text
  // and cd_standard; this document can reach the property, so only contract
  // text crosses into it. Same rule as §1.8.3's property email.
  const { findings: actioned, nonSubstantive } = await getActionedFindings(admin, analysisId);
  // A point raised without wording changes nothing in the contract.
  const findings: CleanContractFinding[] = actioned.filter((f) => f.language.trim()).map((f) => ({
    clause_type: f.clause_type,
    location_section: f.location_section,
    quoted_text: f.quoted_text,
    language: f.language,
    is_missing_clause: f.is_missing_clause,
  }));

  if (findings.length === 0) return noChanges();

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

  // The dialog preflights this format before it downloads it, so without the
  // cache the document is built twice for one click.
  let result;
  try {
    result = await cachedBuild(
      `${associate.id}:${analysisId}:clean`,
      fingerprint([analysis.storage_path, title, findings]),
      () => generateCleanContractPdf({ lines, findings, title })
    );
  } catch (err) {
    return refusal(
      500,
      { error: err instanceof Error ? err.message : "Could not build the contract." },
      "The proposed contract was not exported. The document could not be built."
    );
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
        "The proposed contract was not exported. It failed its content check and was discarded. " +
        "The marked-up PDF carries the same changes.",
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
          layout: "stored_text",
        },
      });
    },
  };
}

function refusal(
  status: number,
  body: ExportRefusalResult["body"],
  summary: string
): ExportRefusalResult {
  return { kind: "refusal", status, body, preflight: null, summary };
}
