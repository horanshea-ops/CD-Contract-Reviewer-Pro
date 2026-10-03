/** A library standard's priority. "note" is a finding severity only, for points outside the library. */
export type Severity = "high" | "medium" | "low" | "note";
export type LibrarySeverity = Exclude<Severity, "note">;

/**
 * What the tool may do with a standard's findings.
 *
 * business  proposes CD's wording for the redline
 * legal     explains the risk to the associate, and never proposes wording
 * other     notes the point without wording; the associate may add some
 */
export type Category = "business" | "legal" | "other";

export type Provenance = "industry_default" | "extracted" | "cd_validated";

export interface StandardEntry {
  // The taxonomy is data. The library in use defines which clause types exist.
  clause_type: string; // snake_case, e.g. "attrition"
  segment: string; // "default" at stage 1; association/corporate/citywide/etc. later
  category: Category;
  position: string; // CD's negotiating position, in plain language
  fallback_language: string; // preferred replacement clause text; sent to the model for business standards only
  walk_away_condition: string; // empty at stage 1
  severity_default: LibrarySeverity;

  // CD's fallback on a business standard. Shown to the associate only, and never sent to the model.
  compromise_range: string;

  version: string;
  provenance: Provenance;
}
