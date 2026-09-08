/**
 * Types for revision-aware DOCX extraction (MASTER_PLAN.md §1.4).
 *
 * The central idea: one text, and a map of exactly equal length. Every
 * character the model sees either traces back to a specific run in the original
 * XML, or is marked synthetic — structure we added (table pipes, heading
 * hashes, list numbers) which is never modified and never maps back.
 *
 * That equality of length is what lets §1.5 take a phrase the model quoted,
 * find it in the text, and know precisely which runs to edit.
 */

/** Which part of the package a character came from. Headers and footers carry contract terms. */
export type PartName = string; // "document" | "header1" | "footer1" | "footnotes" | ...

export interface SourceRef {
  part: PartName;
  /** Index of the containing paragraph, in document order within its part. */
  paragraphIndex: number;
  /** Index of the containing run, in document order within its part. Stable across re-derivation. */
  runIndex: number;
  /** Offset of this character within the run's ORIGINAL text, before normalisation. */
  offsetWithinRun: number;
  /** Inside an existing w:ins — a deletion here must nest inside it (§1.5.7). */
  insideIns: boolean;
  /** Inside a table cell — §1.5.3 refuses spans crossing cell boundaries. */
  insideTable: boolean;
  /** Inside a w:sdt content control — not modifiable (§1.4.7). */
  insideContentControl: boolean;
  /** Inside a field result — not modifiable (§1.4.7). */
  insideField: boolean;
  /** Inside a hyperlink — editing across its boundary orphans the relationship. */
  insideHyperlink: boolean;
}

export interface SyntheticRef {
  synthetic: true;
}

export type MapEntry = SourceRef | SyntheticRef;

export function isSynthetic(e: MapEntry): e is SyntheticRef {
  return (e as SyntheticRef).synthetic === true;
}

export type RevisionKind = "ins" | "del" | "moveFrom" | "moveTo";

export interface RevisionInfo {
  kind: RevisionKind;
  author: string;
  date: string;
  id: string;
}

/** A stretch of text with a single provenance, for the markup view the UI renders. */
export interface MarkupSpan {
  text: string;
  revision: RevisionInfo | null;
  synthetic: boolean;
}

export interface ExtractedPart {
  part: PartName;
  /**
   * What the model reads and what quoted_text is matched against: the accepted
   * view, with synthetic structure markers interleaved.
   */
  text: string;
  /** Same length as `text`. */
  map: MapEntry[];
  /** The contract as originally written — used by §1.6.2's oracle and round diffs. */
  originalText: string;
  /** Everything, tagged, for display. */
  markup: MarkupSpan[];
}

export interface ExistingRevisions {
  present: boolean;
  count: number;
  authors: string[];
  /** Earliest and latest revision dates seen, ISO strings. */
  earliest: string | null;
  latest: string | null;
}

export type HealthCheckName =
  | "archive_integrity"
  | "text_volume"
  | "paragraph_count"
  | "encoding_health"
  | "table_integrity"
  | "map_coverage"
  | "revision_integrity";

export interface HealthCheck {
  name: HealthCheckName;
  passed: boolean;
  detail: string;
}

export type IntakeRoute = "docx_native" | "pdf";

export interface IntakeHealth {
  route: IntakeRoute;
  checks: HealthCheck[];
  /** Populated when route is "pdf" — the first failing check, in plain language. */
  reason: string | null;
}

export interface ExtractedDocument {
  parts: ExtractedPart[];
  /** The main document body. Convenience accessor; also present in `parts`. */
  document: ExtractedPart;
  existingRevisions: ExistingRevisions;
  health: IntakeHealth;
}
