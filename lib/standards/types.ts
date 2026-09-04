export type ClauseType =
  | "attrition"
  | "cancellation"
  | "force_majeure"
  | "fb_minimum"
  | "cutoff_date"
  | "walk_relocation"
  | "mandatory_fees"
  | "rebates"
  | "construction_renovation"
  | "master_account_billing"
  | "review_audit_dates"
  | "insurance_indemnification"
  | "damage_deposit"
  | "exclusivity_vendors"
  | "termination_rights"
  | "assignment_subcontracting"
  | "brand_ownership_change"
  | "named_storm"
  | "attendee_data_handling";

export type Severity = "high" | "medium" | "low" | "note";

export type Provenance = "industry_default" | "extracted" | "cd_validated";

export interface StandardEntry {
  clause_type: ClauseType;
  segment: string; // "default" at stage 1; association/corporate/citywide/etc. later
  position: string; // CD's negotiating position, in plain language
  fallback_language: string; // preferred replacement clause text
  walk_away_condition: string; // empty at stage 1
  severity_default: Severity;
  version: string;
  provenance: Provenance;
}
