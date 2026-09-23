import type { ClausePosition } from "./spec";

/**
 * CD's negotiating positions, restated as checks (MASTER_PLAN.md §2.0.1).
 *
 * Every entry here transcribes the `position` prose of the matching clause in
 * lib/standards/v1.ts. Prose is what the model is handed; a number is what a
 * spec can be compared against, so the same position has to exist in both
 * forms.
 *
 * Two rules keep the two forms from drifting apart. Severity never appears
 * here — the key reads `severity_default` from the loaded library, so a
 * severity change in the library reaches the key without touching this file.
 * And tests/eval/positions.test.ts asserts every clause type here exists in
 * the library and that no library clause type is missing from here.
 *
 * Adding a clause type to the library therefore breaks a test until its
 * position is transcribed, which is the intended failure.
 */
export const CD_POSITIONS: ClausePosition[] = [
  {
    clause_type: "attrition",
    exposure: "unspecified",
    checks: [
      { field: "basis", label: "attrition measurement basis", kind: "enum", allowed: ["cumulative"] },
      { field: "threshold", label: "attrition threshold", kind: "number", comparator: "lte", value: 0.7, unit: "pct" },
      { field: "liability_rate", label: "attrition liability rate", kind: "number", comparator: "lte", value: 0.7, unit: "pct" },
      { field: "high_occupancy_credit", label: "sold-out night credit", kind: "boolean", expected: true },
      { field: "audit_rights", label: "occupancy audit rights", kind: "boolean", expected: true },
    ],
  },
  {
    clause_type: "cancellation",
    exposure: "unspecified",
    checks: [
      { field: "damages_basis", label: "cancellation damages basis", kind: "enum", allowed: ["room_profit"] },
      { field: "sliding_scale", label: "sliding damages scale", kind: "boolean", expected: true },
      { field: "resale_credit", label: "resale credit against damages", kind: "boolean", expected: true },
      { field: "rebook_credit", label: "rebooking credit", kind: "boolean", expected: true },
      { field: "net_rate_basis", label: "room profit on the net rate", kind: "boolean", expected: true },
    ],
    stated: ["top_tier_pct", "liability_free_months"],
  },
  {
    clause_type: "force_majeure",
    exposure: "unspecified",
    checks: [
      { field: "standard", label: "force majeure standard", kind: "enum", allowed: ["impracticable"] },
      { field: "covers_government_restrictions", label: "government travel restrictions", kind: "boolean", expected: true },
      { field: "covers_epidemic", label: "epidemic and pandemic coverage", kind: "boolean", expected: true },
      { field: "covers_unsafe_travel", label: "unsafe or imprudent travel", kind: "boolean", expected: true },
      { field: "deposit_refund", label: "deposit refund on force majeure", kind: "boolean", expected: true },
      { field: "attendee_cancellation_trigger", label: "attendee cancellation trigger", kind: "boolean", expected: true },
    ],
  },
  {
    clause_type: "fb_minimum",
    exposure: "unspecified",
    checks: [
      { field: "menu_price_lock_months", label: "menu price lock window", kind: "number", comparator: "lte", value: 12, unit: "months" },
      { field: "shortfall_rate", label: "food and beverage shortfall rate", kind: "number", comparator: "lte", value: 0.35, unit: "pct" },
    ],
  },
  {
    clause_type: "cutoff_date",
    exposure: "unspecified",
    checks: [
      { field: "days_prior", label: "room block cutoff date", kind: "number", comparator: "lte", value: 21, unit: "days" },
      { field: "post_cutoff_group_rate", label: "group rate after cutoff", kind: "boolean", expected: true },
    ],
  },
  {
    clause_type: "walk_relocation",
    exposure: "unspecified",
    checks: [
      { field: "comparable_accommodation", label: "comparable relocation accommodation", kind: "boolean", expected: true },
      { field: "transportation", label: "round-trip transportation on relocation", kind: "boolean", expected: true },
      { field: "return_upgrade", label: "upgrade and amenity on return", kind: "boolean", expected: true },
      { field: "counts_toward_pickup", label: "relocated night credited to pickup", kind: "boolean", expected: true },
      { field: "per_night_credit", label: "relocation credit per night", kind: "boolean", expected: true },
    ],
  },
  {
    clause_type: "mandatory_fees",
    exposure: "unspecified",
    checks: [
      { field: "disclosed_before_signature", label: "written fee disclosure before signature", kind: "boolean", expected: true },
      { field: "undisclosed_waived", label: "undisclosed charges waived", kind: "boolean", expected: true },
      { field: "resort_fee_usd", label: "resort fee", kind: "number", comparator: "lte", value: 0, unit: "usd" },
    ],
  },
  {
    clause_type: "rebates",
    exposure: "unspecified",
    checks: [
      { field: "comp_room_ratio", label: "complimentary room ratio", kind: "number", comparator: "lte", value: 40, unit: "rooms" },
      { field: "formula_based", label: "formula-based comp calculation", kind: "boolean", expected: true },
      { field: "forfeited_on_attrition", label: "comp rooms forfeited on attrition", kind: "boolean", expected: false },
      { field: "fee_nights_count", label: "fee nights credited to pickup", kind: "boolean", expected: true },
    ],
  },
  {
    clause_type: "construction_renovation",
    exposure: "unspecified",
    checks: [
      { field: "no_current_plans_warranty", label: "no current renovation warranty", kind: "boolean", expected: true },
      { field: "notice_days", label: "renovation notice period", kind: "number", comparator: "gte", value: 30, unit: "days" },
      { field: "termination_if_interferes", label: "termination for interfering renovation", kind: "boolean", expected: true },
    ],
  },
  {
    clause_type: "master_account_billing",
    exposure: "unspecified",
    checks: [
      { field: "dispute_window_days", label: "invoice dispute window", kind: "number", comparator: "gte", value: 15, unit: "days" },
      { field: "finance_charge_monthly_pct", label: "monthly finance charge", kind: "number", comparator: "lte", value: 0.01, unit: "pct" },
      { field: "prepayment_defined", label: "defined prepayment percentage", kind: "boolean", expected: true },
    ],
  },
  {
    clause_type: "review_audit_dates",
    exposure: "forbidden",
    checks: [
      { field: "weekly_pickup_reports", label: "weekly pickup reports", kind: "boolean", expected: true },
      { field: "post_event_report_days", label: "post-event report deadline", kind: "number", comparator: "lte", value: 30, unit: "days" },
      { field: "block_audit_right", label: "room block audit right", kind: "boolean", expected: true },
      { field: "block_review_rights", label: "room block review dates", kind: "boolean", expected: true },
    ],
  },
  {
    clause_type: "insurance_indemnification",
    exposure: "unspecified",
    checks: [
      { field: "mutual", label: "mutual indemnification", kind: "boolean", expected: true },
      { field: "own_negligence_only", label: "indemnity limited to own negligence", kind: "boolean", expected: true },
      { field: "group_liability_limit_usd", label: "group general liability requirement", kind: "number", comparator: "lte", value: 2000000, unit: "usd" },
      { field: "mutual_insurance", label: "mutual insurance obligation", kind: "boolean", expected: true },
    ],
  },
  {
    clause_type: "damage_deposit",
    exposure: "unspecified",
    checks: [
      { field: "refund_window_days", label: "damage deposit refund window", kind: "number", comparator: "lte", value: 30, unit: "days" },
      { field: "offsets_other_charges", label: "deposit applied to unrelated charges", kind: "boolean", expected: false },
    ],
    stated: ["deposit_usd"],
  },
  {
    clause_type: "exclusivity_vendors",
    exposure: "unspecified",
    checks: [
      { field: "outside_vendors_allowed", label: "outside vendor choice", kind: "boolean", expected: true },
      { field: "opt_out_fee_usd", label: "outside vendor surcharge", kind: "number", comparator: "lte", value: 0, unit: "usd" },
    ],
  },
  {
    clause_type: "termination_rights",
    exposure: "unspecified",
    checks: [
      { field: "for_cause_no_liability", label: "termination for cause without liability", kind: "boolean", expected: true },
      { field: "separate_from_cancellation_scale", label: "termination separate from cancellation damages", kind: "boolean", expected: true },
      { field: "pandemic_termination", label: "termination for an epidemic or pandemic", kind: "boolean", expected: true },
    ],
  },
  {
    clause_type: "assignment_subcontracting",
    exposure: "forbidden",
    checks: [
      { field: "assignable_to_successor", label: "assignment to a successor entity", kind: "boolean", expected: true },
      { field: "consent_not_unreasonably_withheld", label: "consent not unreasonably withheld", kind: "boolean", expected: true },
    ],
  },
  {
    clause_type: "brand_ownership_change",
    exposure: "unspecified",
    checks: [
      { field: "notice_days", label: "ownership change notice period", kind: "number", comparator: "lte", value: 30, unit: "days" },
      { field: "termination_window_days", label: "termination window after notice", kind: "number", comparator: "gte", value: 30, unit: "days" },
      { field: "covers_bankruptcy", label: "bankruptcy and foreclosure coverage", kind: "boolean", expected: true },
    ],
  },
  {
    clause_type: "named_storm",
    exposure: "unspecified",
    // Whether a named-storm provision exists at all is carried by the spec
    // marking the clause "absent", not by a boolean inside it. A clause that is
    // present always gets its own numbered section, so a term saying "there is
    // no separate clause" contradicts the heading printed above it.
    checks: [
      { field: "cancellation_window_hours", label: "named storm cancellation window", kind: "number", comparator: "gte", value: 72, unit: "hours" },
    ],
  },
  {
    clause_type: "attendee_data_handling",
    exposure: "forbidden",
    checks: [
      { field: "marketing_use_barred", label: "attendee data used for hotel marketing", kind: "boolean", expected: true },
      { field: "third_party_sale_barred", label: "attendee data sold to third parties", kind: "boolean", expected: true },
    ],
  },
  {
    clause_type: "ada_compliance",
    exposure: "forbidden",
    checks: [
      { field: "hotel_warranty", label: "hotel ADA compliance warranty", kind: "boolean", expected: true },
      { field: "auxiliary_aids_split", label: "auxiliary aids cost split", kind: "boolean", expected: true },
    ],
  },
  {
    clause_type: "governing_law_venue",
    exposure: "forbidden",
    checks: [
      { field: "venue", label: "governing law and venue", kind: "enum", allowed: ["group_state"] },
      { field: "punitive_damages_barred", label: "punitive damages", kind: "boolean", expected: true },
      { field: "each_party_own_fees", label: "attorney's fees", kind: "boolean", expected: true },
    ],
  },
  {
    clause_type: "labor_disputes",
    exposure: "unspecified",
    checks: [
      { field: "cba_expiry_notice_months", label: "collective bargaining expiry notice", kind: "number", comparator: "gte", value: 12, unit: "months" },
      { field: "cancel_window_days", label: "labor dispute cancellation window", kind: "number", comparator: "gte", value: 90, unit: "days" },
      { field: "cancel_no_liability", label: "labor dispute cancellation liability", kind: "boolean", expected: true },
    ],
  },
  {
    clause_type: "rate_parity",
    exposure: "unspecified",
    checks: [
      { field: "guaranteed", label: "rate parity guarantee", kind: "boolean", expected: true },
      { field: "retroactive_adjustment", label: "retroactive rate adjustment", kind: "boolean", expected: true },
      { field: "commission_preserved", label: "commission on adjusted rates", kind: "boolean", expected: true },
      { field: "lowest_group_rate", label: "lowest group rate", kind: "boolean", expected: true },
    ],
  },
  {
    clause_type: "gratuity_service_charge",
    exposure: "unspecified",
    checks: [
      { field: "separately_defined", label: "gratuity and service charge defined separately", kind: "boolean", expected: true },
      { field: "gratuity_to_staff", label: "gratuity distributed to staff", kind: "boolean", expected: true },
      { field: "service_charge_disclosed", label: "service charge disclosed as hotel revenue", kind: "boolean", expected: true },
    ],
    stated: ["service_charge_pct"],
  },
  {
    clause_type: "resale_mitigation_duty",
    exposure: "unspecified",
    checks: [
      { field: "affirmative_duty", label: "affirmative duty to resell", kind: "boolean", expected: true },
      { field: "proceeds_credited", label: "resale proceeds credited", kind: "boolean", expected: true },
      { field: "records_available", label: "resale records available to group", kind: "boolean", expected: true },
      { field: "damages_due_after_event", label: "damages due after the event", kind: "boolean", expected: true },
    ],
  },
  {
    clause_type: "commission",
    exposure: "unspecified",
    checks: [
      { field: "commission_pct", label: "commission rate", kind: "number", comparator: "gte", value: 0.1, unit: "pct" },
      { field: "outside_block_commissionable", label: "commission on rooms outside the block", kind: "boolean", expected: true },
      { field: "paid_within_days", label: "commission payment deadline", kind: "number", comparator: "lte", value: 30, unit: "days" },
    ],
  },
  {
    clause_type: "hotel_cancellation",
    exposure: "unspecified",
    checks: [
      { field: "consequential_damages", label: "hotel liability for wrongful cancellation", kind: "boolean", expected: true },
      { field: "attorney_fees", label: "attorney's fees on hotel cancellation", kind: "boolean", expected: true },
    ],
  },
  {
    clause_type: "function_space",
    exposure: "unspecified",
    checks: [
      { field: "assignments_specified", label: "named function room assignments", kind: "boolean", expected: true },
      { field: "changes_need_consent", label: "consent to function space changes", kind: "boolean", expected: true },
      { field: "rental_waived", label: "meeting room rental waived", kind: "boolean", expected: true },
    ],
  },
  {
    clause_type: "facilities_services",
    exposure: "unspecified",
    checks: [
      { field: "reduction_threshold_pct", label: "facility reduction threshold", kind: "number", comparator: "lte", value: 0.25, unit: "pct" },
      { field: "alternatives_at_hotel_expense", label: "alternatives at the hotel's expense", kind: "boolean", expected: true },
      { field: "cancel_no_liability", label: "cancellation right for reduced facilities", kind: "boolean", expected: true },
    ],
  },
  {
    clause_type: "future_rate_cap",
    exposure: "unspecified",
    checks: [
      { field: "max_annual_increase_pct", label: "annual room rate increase cap", kind: "number", comparator: "lte", value: 0.02, unit: "pct" },
      { field: "decline_adjustment", label: "rate reduction on market decline", kind: "boolean", expected: true },
      { field: "rates_final_months", label: "final rate confirmation", kind: "number", comparator: "gte", value: 12, unit: "months" },
    ],
  },
  {
    clause_type: "nondiscrimination",
    exposure: "forbidden",
    checks: [
      { field: "hotel_nondiscrimination", label: "hotel nondiscrimination commitment", kind: "boolean", expected: true },
      { field: "terminate_on_discriminatory_law", label: "termination on discriminatory legislation", kind: "boolean", expected: true },
    ],
  },
  {
    clause_type: "reservation_procedures",
    exposure: "unspecified",
    checks: [
      { field: "name_changes_at_group_rate", label: "name changes at the group rate", kind: "boolean", expected: true },
      { field: "no_show_reinstated", label: "no-show reinstatement", kind: "boolean", expected: true },
      { field: "same_day_cancellation", label: "individual cancellation until arrival day", kind: "boolean", expected: true },
    ],
  },
  {
    clause_type: "banquet_service_levels",
    exposure: "unspecified",
    checks: [
      { field: "server_ratios_stated", label: "minimum banquet staffing ratios", kind: "boolean", expected: true },
      { field: "no_labor_fees", label: "banquet labor fees", kind: "boolean", expected: true },
    ],
  },
  {
    clause_type: "av_internet",
    exposure: "unspecified",
    checks: [
      { field: "quotes_honored", label: "audio-visual and internet quotes honored", kind: "boolean", expected: true },
      { field: "in_house_av_not_condition", label: "in-house audio-visual as a condition", kind: "boolean", expected: true },
      { field: "bandwidth_specified", label: "minimum internet bandwidth", kind: "boolean", expected: true },
    ],
  },
];

export const POSITION_BY_CLAUSE = new Map(CD_POSITIONS.map((p) => [p.clause_type, p]));

/** Every field a clause can state, checked or not, in a stable order. */
export function clauseFields(clauseType: string): string[] {
  const position = POSITION_BY_CLAUSE.get(clauseType);
  if (!position) throw new Error(`No CD position transcribed for clause type "${clauseType}".`);
  return [...position.checks.map((c) => c.field), ...(position.stated ?? [])];
}
