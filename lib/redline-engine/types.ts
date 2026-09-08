import type { MemoFinding } from "../export-memo";

/**
 * Types for the revision engine (MASTER_PLAN.md §1.5).
 */

/**
 * What the engine needs about a finding, beyond what the export formats need.
 *
 * `id` is here so the resolution tier and the applicability verdict can be
 * written back to the row (§1.5.1, §1.5.3), and `location_section` because it is
 * what separates two copies of the same wording (§1.5.1). Both are already
 * stored; `getActionedFindings` simply does not select them today.
 */
export interface RevisionFinding extends MemoFinding {
  id: string;
  location_section: string | null;
}

/** How confidently the wording was found. Written to `findings.span_resolution`. */
export type SpanResolution = "exact" | "normalized" | "fuzzy" | "unresolved";

/** Why a located span still cannot be edited. Mirrors `findings.applicability`. */
export type Applicability =
  | "applicable"
  | "blocked_table"
  | "blocked_content_control"
  | "blocked_field"
  | "blocked_cross_paragraph"
  | "blocked_already_deleted";

export interface LocatedSpan {
  /** Part name as §1.4 reports it — "document", "header1", ... */
  part: string;
  /** Half-open range into that part's accepted-view text. */
  start: number;
  end: number;
  resolution: Exclude<SpanResolution, "unresolved">;
  /** 1 for an exact or normalised hit; the measured ratio for a fuzzy one. */
  similarity: number;
}

export interface UnlocatedSpan {
  resolution: "unresolved";
  /** Plain language, recorded in `findings.applicability_detail`. */
  reason: string;
  /**
   * True when the wording was found in several places and nothing separated
   * them. A different problem from wording that is not in the contract at all,
   * and the associate needs to be told which.
   */
  ambiguous?: boolean;
}

export type LocateResult = LocatedSpan | UnlocatedSpan;

export const isLocated = (r: LocateResult): r is LocatedSpan => r.resolution !== "unresolved";
