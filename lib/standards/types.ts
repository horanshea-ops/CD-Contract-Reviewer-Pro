export type Severity = "high" | "medium" | "low" | "note";

export type Provenance = "industry_default" | "extracted" | "cd_validated";

export interface StandardEntry {
  // The taxonomy is data. The library in use defines which clause types exist.
  clause_type: string; // snake_case, e.g. "attrition"
  segment: string; // "default" at stage 1; association/corporate/citywide/etc. later
  position: string; // CD's negotiating position, in plain language
  fallback_language: string; // preferred replacement clause text
  walk_away_condition: string; // empty at stage 1
  severity_default: Severity;
  version: string;
  provenance: Provenance;
}
