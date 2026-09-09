import type { SupabaseClient } from "@supabase/supabase-js";
import type { ExportOutcome, UnappliedFinding } from "./redline-validation";

/**
 * The export record (MASTER_PLAN.md §1.6.5, §1.6.6, §1.6.7).
 *
 * Every export writes a row saying what left the building and whether it was
 * degraded. §1.6.5 calls for reviewing these weekly during the pilot, which is
 * only possible if the reasons are stored rather than inferred.
 */

export type ExportFormat = "docx" | "pdf" | "memo";

export interface RecordExportInput {
  analysisId: string;
  associateId: string;
  format: ExportFormat;
  outcome: ExportOutcome;
  fallbackReason?: string | null;
  findingsApplied?: number | null;
  findingsUnapplied?: number | null;
  /**
   * What could not be applied, for the weekly review. Shapes differ by export —
   * the redline records a severity and the quoted text, while §1.7.7's clean
   * contract carries neither, since that document can reach the property and
   * only contract text may cross into it.
   */
  unappliedDetail?: UnappliedDetail[] | null;
  /** Where the generated file was stored, if it was stored at all. */
  storagePath?: string | null;
  /** The analysis's own paths, so the guard below has something to compare against. */
  analysisPaths: { storage_path: string | null; original_storage_path: string | null };
}

/** A change that did not make it into an export, in whichever shape that export knows. */
export type UnappliedDetail = UnappliedFinding | { clause_type: string; reason: string };

export class OriginalOverwriteError extends Error {}

/**
 * Records how each finding resolved (§1.5.1, §1.5.3).
 *
 * Written at export because that is when it is known — the span is located
 * against the document as it stands, never cached. Best effort: a failure here
 * must not cost the associate their download.
 */
export async function recordResolutions(
  admin: SupabaseClient,
  resolutions: {
    findingId: string;
    spanResolution: string;
    applicability: string;
    detail: string;
  }[]
): Promise<void> {
  await Promise.all(
    resolutions.map(async (r) => {
      const { error } = await admin
        .from("findings")
        .update({
          span_resolution: r.spanResolution,
          applicability: r.applicability,
          applicability_detail: r.detail,
        })
        .eq("id", r.findingId);
      if (error) console.error(`Could not record how finding ${r.findingId} resolved:`, error.message);
    })
  );
}

/**
 * §1.6.7 — never overwrite the stored original. Asserted in code, not by
 * convention.
 *
 * This is the only place an export's storage path is written, so the check
 * belongs here. Nothing uploads bytes yet; §1.9.4, which stores the file sent
 * in every round, inherits a writer that already refuses to clobber either the
 * uploaded document or the PDF rendered from it.
 */
function assertNotAnOriginal(storagePath: string, paths: RecordExportInput["analysisPaths"]) {
  if (storagePath === paths.original_storage_path) {
    throw new OriginalOverwriteError(
      `Refusing to write an export over the uploaded original at ${storagePath}.`
    );
  }
  if (storagePath === paths.storage_path) {
    throw new OriginalOverwriteError(
      `Refusing to write an export over the analysed document at ${storagePath}.`
    );
  }
}

export async function recordExport(
  admin: SupabaseClient,
  input: RecordExportInput
): Promise<{ id: string } | null> {
  if (input.storagePath) assertNotAnOriginal(input.storagePath, input.analysisPaths);

  const { data, error } = await admin
    .from("exports")
    .insert({
      analysis_id: input.analysisId,
      associate_id: input.associateId,
      format: input.format,
      outcome: input.outcome,
      fallback_reason: input.fallbackReason ?? null,
      findings_applied: input.findingsApplied ?? null,
      findings_unapplied: input.findingsUnapplied ?? null,
      unapplied_detail: input.unappliedDetail ?? null,
      storage_path: input.storagePath ?? null,
    })
    .select("id")
    .maybeSingle();

  // An export that succeeded must not fail because the log did. The row is for
  // the weekly review, not for the associate waiting on a download.
  if (error) {
    console.error("Could not record the export:", error.message);
    return null;
  }
  return data;
}

export interface DegradationRate {
  exports: number;
  clean: number;
  partial: number;
  fallback: number;
  analyses: number;
  intakePdfRouted: number;
  /** §1.6.6's combined rate: intake routed to PDF plus exports that fell back. */
  combinedRate: number;
  reading: "working" | "acceptable" | "not working" | "no data";
  topReasons: { reason: string; count: number }[];
}

/** §1.6.6's thresholds, read against the combined rate. */
export function readRate(rate: number, sample: number): DegradationRate["reading"] {
  if (sample === 0) return "no data";
  if (rate < 0.05) return "working";
  if (rate <= 0.15) return "acceptable";
  return "not working";
}

/**
 * §1.6.6 — the degradation rate, tracked against a target.
 *
 * The PDF fallback protects against catastrophe, not against mediocrity, and
 * the difference between the two is this number. It combines both ways a
 * contract loses its tracked-changes path: routed to PDF at intake because the
 * document could not be read, or marked up and then rejected by the oracle.
 */
export async function degradationRate(
  admin: SupabaseClient,
  since?: Date
): Promise<DegradationRate> {
  const sinceIso = (since ?? new Date(0)).toISOString();

  const { data: exportRows } = await admin
    .from("exports")
    .select("outcome, fallback_reason")
    .eq("format", "docx")
    .gte("created_at", sinceIso);
  const { data: analysisRows } = await admin
    .from("analyses")
    .select("intake_route")
    .eq("status", "complete")
    .gte("created_at", sinceIso);

  const exports = exportRows ?? [];
  const analyses = analysisRows ?? [];

  const count = (o: ExportOutcome) => exports.filter((r) => r.outcome === o).length;
  const fallback = count("fallback");
  const intakePdfRouted = analyses.filter((r) => r.intake_route === "pdf").length;

  const denominator = analyses.length + exports.length;
  const combinedRate = denominator === 0 ? 0 : (intakePdfRouted + fallback) / denominator;

  const reasons = new Map<string, number>();
  for (const row of exports) {
    if (!row.fallback_reason) continue;
    // The first clause of the message is the cause; the rest names the part.
    const key = String(row.fallback_reason).split(":")[0].slice(0, 80);
    reasons.set(key, (reasons.get(key) ?? 0) + 1);
  }

  return {
    exports: exports.length,
    clean: count("clean"),
    partial: count("partial"),
    fallback,
    analyses: analyses.length,
    intakePdfRouted,
    combinedRate,
    reading: readRate(combinedRate, denominator),
    topReasons: [...reasons.entries()]
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 3),
  };
}
