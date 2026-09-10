import type { ClauseTerms, EvalContractSpec, SpecClause } from "./spec";

/**
 * The eval contracts, as specs (MASTER_PLAN.md §2.0.1).
 *
 * Invented hotels, invented groups, invented numbers. No CD client contract
 * reaches this file or the corpus it generates, per §1.11's standing rule.
 *
 * Each contract starts from one of three profiles and overrides what makes it
 * interesting. The profiles are not a shortcut — they are themselves explicit
 * declarations of every field, which is what deriveKeyItems requires. A clause
 * the spec forgets is an error, never a default.
 *
 * The corpus is built to measure more than one kind of failure, so it
 * deliberately contains clauses CD would NOT object to. A corpus of nothing but
 * defects rewards a model that flags everything, and would report that model as
 * perfect.
 */

/** Hotel-favourable on every clause. The base for the aggressive drafts. */
const ADVERSE: Record<string, ClauseTerms> = {
  attrition: { basis: "night_by_night", threshold: 0.9, liability_rate: 1.0, high_occupancy_credit: false, audit_rights: false },
  cancellation: { damages_basis: "gross_revenue", sliding_scale: true, resale_credit: false, rebook_credit: false, liability_free_months: 0, top_tier_pct: 1.0 },
  force_majeure: { standard: "impossible", covers_government_restrictions: false, covers_epidemic: false, covers_unsafe_travel: false, deposit_refund: false },
  fb_minimum: { menu_price_lock_months: 24, shortfall_rate: 1.0 },
  cutoff_date: { days_prior: 45, post_cutoff_group_rate: false },
  walk_relocation: { comparable_accommodation: false, transportation: false, return_upgrade: false, counts_toward_pickup: false },
  mandatory_fees: { disclosed_before_signature: false, undisclosed_waived: false, resort_fee_usd: 35 },
  rebates: { comp_room_ratio: 75, formula_based: false, forfeited_on_attrition: true },
  construction_renovation: { no_current_plans_warranty: false, notice_days: 0, termination_if_interferes: false },
  master_account_billing: { dispute_window_days: 0, finance_charge_monthly_pct: 0.015, prepayment_defined: false },
  review_audit_dates: { weekly_pickup_reports: false, post_event_report_days: 90, block_audit_right: false },
  insurance_indemnification: { mutual: false, own_negligence_only: false, group_liability_limit_usd: 5000000 },
  damage_deposit: { refund_window_days: 90, offsets_other_charges: true, deposit_usd: 25000 },
  exclusivity_vendors: { outside_vendors_allowed: false, opt_out_fee_usd: 2500 },
  termination_rights: { for_cause_no_liability: false, separate_from_cancellation_scale: false },
  assignment_subcontracting: { assignable_to_successor: false, consent_not_unreasonably_withheld: false },
  brand_ownership_change: { notice_days: 90, termination_window_days: 10, covers_bankruptcy: false },
  named_storm: { separate_clause: false, cancellation_window_hours: 24 },
  attendee_data_handling: { marketing_use_barred: false, third_party_sale_barred: false },
  ada_compliance: { hotel_warranty: false, auxiliary_aids_split: false },
  governing_law_venue: { venue: "hotel_state", punitive_damages_barred: false, each_party_own_fees: false },
  labor_disputes: { cba_expiry_notice_months: 0, cancel_window_days: 0, cancel_no_liability: false },
  rate_parity: { guaranteed: false, retroactive_adjustment: false, commission_preserved: false },
  gratuity_service_charge: { separately_defined: false, gratuity_to_staff: false, service_charge_disclosed: false, service_charge_pct: 0.24 },
  resale_mitigation_duty: { affirmative_duty: false, proceeds_credited: false, records_available: false },
};

/** Passes every check CD makes. A contract built from this alone keys to nothing. */
const COMPLIANT: Record<string, ClauseTerms> = {
  attrition: { basis: "cumulative", threshold: 0.7, liability_rate: 0.7, high_occupancy_credit: true, audit_rights: true },
  cancellation: { damages_basis: "room_profit", sliding_scale: true, resale_credit: true, rebook_credit: true, liability_free_months: 12, top_tier_pct: 0.7 },
  force_majeure: { standard: "impracticable", covers_government_restrictions: true, covers_epidemic: true, covers_unsafe_travel: true, deposit_refund: true },
  fb_minimum: { menu_price_lock_months: 12, shortfall_rate: 0.35 },
  cutoff_date: { days_prior: 30, post_cutoff_group_rate: true },
  walk_relocation: { comparable_accommodation: true, transportation: true, return_upgrade: true, counts_toward_pickup: true },
  mandatory_fees: { disclosed_before_signature: true, undisclosed_waived: true, resort_fee_usd: 0 },
  rebates: { comp_room_ratio: 40, formula_based: true, forfeited_on_attrition: false },
  construction_renovation: { no_current_plans_warranty: true, notice_days: 30, termination_if_interferes: true },
  master_account_billing: { dispute_window_days: 30, finance_charge_monthly_pct: 0.01, prepayment_defined: true },
  review_audit_dates: { weekly_pickup_reports: true, post_event_report_days: 30, block_audit_right: true },
  insurance_indemnification: { mutual: true, own_negligence_only: true, group_liability_limit_usd: 1000000 },
  damage_deposit: { refund_window_days: 30, offsets_other_charges: false, deposit_usd: 0 },
  exclusivity_vendors: { outside_vendors_allowed: true, opt_out_fee_usd: 0 },
  termination_rights: { for_cause_no_liability: true, separate_from_cancellation_scale: true },
  assignment_subcontracting: { assignable_to_successor: true, consent_not_unreasonably_withheld: true },
  brand_ownership_change: { notice_days: 30, termination_window_days: 30, covers_bankruptcy: true },
  named_storm: { separate_clause: true, cancellation_window_hours: 72 },
  attendee_data_handling: { marketing_use_barred: true, third_party_sale_barred: true },
  ada_compliance: { hotel_warranty: true, auxiliary_aids_split: true },
  governing_law_venue: { venue: "group_state", punitive_damages_barred: true, each_party_own_fees: true },
  labor_disputes: { cba_expiry_notice_months: 12, cancel_window_days: 90, cancel_no_liability: true },
  rate_parity: { guaranteed: true, retroactive_adjustment: true, commission_preserved: true },
  gratuity_service_charge: { separately_defined: true, gratuity_to_staff: true, service_charge_disclosed: true, service_charge_pct: 0.22 },
  resale_mitigation_duty: { affirmative_duty: true, proceeds_credited: true, records_available: true },
};

type Patch = Record<string, Partial<ClauseTerms> | "absent">;

/**
 * Applies per-clause overrides to a profile.
 *
 * A patch names fields, not whole clauses, so an override says what this
 * contract does differently and nothing else. Field names are still checked
 * against the position — deriveKeyItems rejects a clause whose fields do not
 * match — so a typo here fails the build rather than shifting a key item.
 */
function from(base: Record<string, ClauseTerms>, patch: Patch): Record<string, SpecClause> {
  const out: Record<string, SpecClause> = { ...base };
  for (const [clause, override] of Object.entries(patch)) {
    if (!(clause in base)) throw new Error(`Patch names clause "${clause}", which no profile declares.`);
    if (override === "absent") {
      out[clause] = "absent";
      continue;
    }
    const merged: ClauseTerms = { ...base[clause] };
    for (const [field, value] of Object.entries(override)) {
      if (value !== undefined) merged[field] = value;
    }
    out[clause] = merged;
  }
  return out;
}

const ALL_SPECS: EvalContractSpec[] = [
  {
    id: "eval-01-harborview",
    hotel: "Harborview Grand Hotel",
    group: "National Association of Coastal Engineers",
    city: "Baltimore",
    state: "Maryland",
    dates: "April 12-16, 2027",
    room_block: 340,
    nights: 4,
    adr: 289,
    fb_minimum: 185000,
    style: { voice: "verbose", tables: "many", exhibits: true, header_footer_terms: false },
    intent: "Aggressive big-city convention hotel. Nearly every clause deviates, so recall has a wide base.",
    terms: from(ADVERSE, {}),
  },
  {
    id: "eval-02-cedarcrest",
    hotel: "Cedarcrest Lodge and Conference Center",
    group: "Midwest Credit Union League",
    city: "Madison",
    state: "Wisconsin",
    dates: "September 8-11, 2027",
    room_block: 180,
    nights: 3,
    adr: 214,
    fb_minimum: 72000,
    style: { voice: "terse", tables: "few", exhibits: false, header_footer_terms: false },
    intent: "Middle-of-the-road regional property. Roughly half the clauses deviate, half do not.",
    terms: from(COMPLIANT, {
      attrition: { basis: "night_by_night", threshold: 0.85 },
      cancellation: { damages_basis: "gross_revenue", resale_credit: false },
      fb_minimum: { shortfall_rate: 1.0 },
      cutoff_date: { days_prior: 45 },
      mandatory_fees: { disclosed_before_signature: false, resort_fee_usd: 18 },
      insurance_indemnification: { mutual: false, own_negligence_only: false },
      governing_law_venue: { venue: "hotel_state" },
      rebates: { comp_room_ratio: 50 },
    }),
  },
  {
    id: "eval-03-bayfront",
    hotel: "Bayfront Harbor Hotel",
    group: "Pacific Library Consortium",
    city: "Portland",
    state: "Oregon",
    dates: "June 2-5, 2027",
    room_block: 145,
    nights: 3,
    adr: 199,
    fb_minimum: 48000,
    style: { voice: "terse", tables: "few", exhibits: false, header_footer_terms: false },
    intent:
      "Almost entirely CD-compliant. This is the corpus's false-positive test — a model that flags everything scores badly here and nowhere else.",
    terms: from(COMPLIANT, {
      attrition: { threshold: 0.75 },
      cutoff_date: { days_prior: 35 },
    }),
  },
  {
    id: "eval-04-summit-plaza",
    hotel: "Summit Plaza Hotel and Towers",
    group: "American Society of Structural Metallurgists",
    city: "Denver",
    state: "Colorado",
    dates: "March 3-7, 2027",
    room_block: 420,
    nights: 4,
    adr: 265,
    fb_minimum: 240000,
    style: { voice: "verbose", tables: "many", exhibits: true, header_footer_terms: false },
    intent:
      "Table-heavy. The cancellation schedule and attrition scale are grids, which is where §1.4.5 says the model was previously blind.",
    terms: from(ADVERSE, {
      force_majeure: { covers_government_restrictions: true, deposit_refund: true },
      ada_compliance: { hotel_warranty: true, auxiliary_aids_split: true },
      attendee_data_handling: { marketing_use_barred: true, third_party_sale_barred: true },
      review_audit_dates: { weekly_pickup_reports: true, post_event_report_days: 30 },
    }),
  },
  {
    id: "eval-05-riverwalk",
    hotel: "Riverwalk Inn and Suites",
    group: "Texas Municipal Clerks Association",
    city: "San Antonio",
    state: "Texas",
    dates: "October 19-21, 2027",
    room_block: 95,
    nights: 2,
    adr: 168,
    fb_minimum: 26000,
    style: { voice: "terse", tables: "few", exhibits: false, header_footer_terms: false },
    intent: "A thin contract. Twelve clause types are simply not there, so missing-clause detection carries the weight.",
    terms: from(COMPLIANT, {
      attrition: { basis: "night_by_night", threshold: 0.9, liability_rate: 0.9 },
      cancellation: { damages_basis: "gross_revenue", resale_credit: false, rebook_credit: false },
      named_storm: "absent",
      attendee_data_handling: "absent",
      ada_compliance: "absent",
      rate_parity: "absent",
      labor_disputes: "absent",
      gratuity_service_charge: "absent",
      resale_mitigation_duty: "absent",
      brand_ownership_change: "absent",
      assignment_subcontracting: "absent",
      review_audit_dates: "absent",
      construction_renovation: "absent",
      walk_relocation: "absent",
    }),
  },
  {
    id: "eval-06-lakeshore",
    hotel: "Lakeshore Pavilion Hotel",
    group: "Great Lakes Dental Educators",
    city: "Chicago",
    state: "Illinois",
    dates: "May 17-20, 2027",
    room_block: 260,
    nights: 3,
    adr: 245,
    fb_minimum: 118000,
    style: { voice: "brand_boilerplate", tables: "few", exhibits: false, header_footer_terms: true },
    intent: "Carries binding terms in the running header and footer, as hotels routinely do.",
    terms: from(COMPLIANT, {
      cutoff_date: { days_prior: 60, post_cutoff_group_rate: false },
      mandatory_fees: { disclosed_before_signature: false, undisclosed_waived: false, resort_fee_usd: 29 },
      damage_deposit: { refund_window_days: 60, offsets_other_charges: true, deposit_usd: 15000 },
      exclusivity_vendors: { outside_vendors_allowed: false, opt_out_fee_usd: 1800 },
      master_account_billing: { dispute_window_days: 5, finance_charge_monthly_pct: 0.018 },
    }),
  },
  {
    id: "eval-07-monarch",
    hotel: "The Monarch on Fifth",
    group: "Institute of Certified Actuarial Analysts",
    city: "New York",
    state: "New York",
    dates: "November 9-12, 2027",
    room_block: 210,
    nights: 3,
    adr: 419,
    fb_minimum: 165000,
    style: { voice: "verbose", tables: "few", exhibits: false, header_footer_terms: false },
    intent:
      "Every deviation is marginal rather than flagrant. Measures whether near-misses are caught at all, not whether obvious ones are.",
    terms: from(COMPLIANT, {
      attrition: { threshold: 0.75, liability_rate: 0.75 },
      cutoff_date: { days_prior: 32 },
      fb_minimum: { menu_price_lock_months: 14, shortfall_rate: 0.4 },
      rebates: { comp_room_ratio: 45 },
      master_account_billing: { dispute_window_days: 12, finance_charge_monthly_pct: 0.0125 },
      brand_ownership_change: { notice_days: 35, termination_window_days: 25 },
      labor_disputes: { cba_expiry_notice_months: 9, cancel_window_days: 75 },
      named_storm: { cancellation_window_hours: 60 },
      insurance_indemnification: { group_liability_limit_usd: 2500000 },
    }),
  },
  {
    id: "eval-08-gulfview",
    hotel: "Gulfview Beach Resort",
    group: "Southeastern Marine Contractors Alliance",
    city: "Tampa",
    state: "Florida",
    dates: "August 24-27, 2027",
    room_block: 300,
    nights: 3,
    adr: 232,
    fb_minimum: 140000,
    style: { voice: "verbose", tables: "many", exhibits: true, header_footer_terms: false },
    intent: "Hurricane-belt resort. Named-storm and force-majeure language are both present and both weak.",
    terms: from(ADVERSE, {
      named_storm: { separate_clause: true, cancellation_window_hours: 36 },
      attrition: { threshold: 0.8, liability_rate: 0.85 },
      cancellation: { resale_credit: true },
      walk_relocation: { comparable_accommodation: true, transportation: true },
      governing_law_venue: { punitive_damages_barred: true },
      rate_parity: { guaranteed: true },
    }),
  },
  {
    id: "eval-09-pinnacle",
    hotel: "Pinnacle Center Hotel",
    group: "North American Trade Exhibitors Council",
    city: "Atlanta",
    state: "Georgia",
    dates: "February 8-12, 2027",
    room_block: 385,
    nights: 4,
    adr: 251,
    fb_minimum: 210000,
    style: { voice: "brand_boilerplate", tables: "many", exhibits: true, header_footer_terms: false },
    intent: "Exhibition property with hard in-house vendor requirements and punitive rebate terms.",
    terms: from(COMPLIANT, {
      exclusivity_vendors: { outside_vendors_allowed: false, opt_out_fee_usd: 4500 },
      rebates: { comp_room_ratio: 100, formula_based: false, forfeited_on_attrition: true },
      mandatory_fees: { disclosed_before_signature: false, undisclosed_waived: false, resort_fee_usd: 22 },
      gratuity_service_charge: { separately_defined: false, service_charge_disclosed: false, service_charge_pct: 0.26 },
      attrition: { basis: "night_by_night", liability_rate: 0.95 },
      damage_deposit: { deposit_usd: 40000, offsets_other_charges: true },
    }),
  },
  {
    id: "eval-10-crossroads",
    hotel: "Crossroads Convention Hotel",
    group: "Interstate Freight Brokers Federation",
    city: "Indianapolis",
    state: "Indiana",
    dates: "July 13-16, 2027",
    room_block: 275,
    nights: 3,
    adr: 189,
    fb_minimum: 96000,
    style: { voice: "verbose", tables: "few", exhibits: false, header_footer_terms: false },
    intent:
      "The same adverse percentage appears in four separate clauses. A quote of it alone resolves nowhere, so the harness has to fall back to clause type and report the ambiguity.",
    terms: from(ADVERSE, {
      attrition: { threshold: 0.8, liability_rate: 0.8 },
      cancellation: { top_tier_pct: 0.8 },
      fb_minimum: { shortfall_rate: 0.8 },
      rebates: { comp_room_ratio: 80 },
      force_majeure: { covers_epidemic: true, covers_unsafe_travel: true },
      ada_compliance: { hotel_warranty: true, auxiliary_aids_split: true },
    }),
  },
  {
    id: "eval-11-old-mill",
    hotel: "The Old Mill Hotel",
    group: "New England Historic Preservation Trust",
    city: "Providence",
    state: "Rhode Island",
    dates: "October 5-7, 2027",
    room_block: 120,
    nights: 2,
    adr: 227,
    fb_minimum: 38000,
    style: { voice: "verbose", tables: "few", exhibits: true, header_footer_terms: false },
    intent:
      "Reads as reasonable throughout, with two severe deviations buried in long compliant clauses. Measures whether a fair-looking contract gets read carefully.",
    terms: from(COMPLIANT, {
      insurance_indemnification: { mutual: false, own_negligence_only: false },
      attrition: { basis: "night_by_night", threshold: 0.95, liability_rate: 1.0 },
    }),
  },
  {
    id: "eval-12-granite-bay",
    hotel: "Granite Bay Hotel and Spa",
    group: "West Coast Public Employees Assembly",
    city: "San Francisco",
    state: "California",
    dates: "April 26-29, 2027",
    room_block: 230,
    nights: 3,
    adr: 372,
    fb_minimum: 155000,
    style: { voice: "brand_boilerplate", tables: "few", exhibits: false, header_footer_terms: true },
    intent: "Heavily unionised market. The labour, gratuity and service-charge clauses are the point.",
    terms: from(COMPLIANT, {
      labor_disputes: { cba_expiry_notice_months: 0, cancel_window_days: 30, cancel_no_liability: false },
      gratuity_service_charge: { separately_defined: false, gratuity_to_staff: false, service_charge_disclosed: false, service_charge_pct: 0.25 },
      master_account_billing: { finance_charge_monthly_pct: 0.02, dispute_window_days: 7 },
      exclusivity_vendors: { outside_vendors_allowed: false, opt_out_fee_usd: 3200 },
      construction_renovation: { no_current_plans_warranty: false, notice_days: 14 },
    }),
  },
  {
    id: "eval-13-northstar",
    hotel: "Northstar Summit Resort",
    group: "Rocky Mountain Orthopaedic Society",
    city: "Salt Lake City",
    state: "Utah",
    dates: "January 18-22, 2027",
    room_block: 400,
    nights: 4,
    adr: 310,
    fb_minimum: 225000,
    style: { voice: "verbose", tables: "many", exhibits: true, header_footer_terms: false },
    intent:
      "A large block with a high undisclosed resort fee. The only clause in the corpus whose dollar exposure follows from stated figures in one step.",
    terms: from(ADVERSE, {
      mandatory_fees: { disclosed_before_signature: false, undisclosed_waived: false, resort_fee_usd: 42 },
      force_majeure: { standard: "impracticable", covers_epidemic: true },
      termination_rights: { for_cause_no_liability: true },
      review_audit_dates: { weekly_pickup_reports: true, block_audit_right: true, post_event_report_days: 30 },
      governing_law_venue: { venue: "group_state", each_party_own_fees: true },
    }),
  },
  {
    id: "eval-14-parkside",
    hotel: "Parkside Executive Hotel",
    group: "Mid-Atlantic Association Management Group",
    city: "Philadelphia",
    state: "Pennsylvania",
    dates: "December 1-3, 2027",
    room_block: 160,
    nights: 2,
    adr: 205,
    fb_minimum: 54000,
    style: { voice: "terse", tables: "few", exhibits: false, header_footer_terms: false },
    intent:
      "An association that rotates management companies. Assignment and ownership-change terms matter, and several low-severity clauses are absent.",
    terms: from(COMPLIANT, {
      assignment_subcontracting: { assignable_to_successor: false, consent_not_unreasonably_withheld: false },
      brand_ownership_change: { notice_days: 120, termination_window_days: 7, covers_bankruptcy: false },
      termination_rights: { for_cause_no_liability: false, separate_from_cancellation_scale: false },
      attendee_data_handling: "absent",
      rate_parity: "absent",
      named_storm: "absent",
      rebates: "absent",
      damage_deposit: "absent",
    }),
  },
  {
    id: "eval-15-vantage",
    hotel: "Vantage Point Hotel and Convention Center",
    group: "United Federation of Applied Sciences",
    city: "Seattle",
    state: "Washington",
    dates: "August 2-7, 2027",
    room_block: 465,
    nights: 5,
    adr: 279,
    fb_minimum: 310000,
    style: { voice: "verbose", tables: "many", exhibits: true, header_footer_terms: true },
    intent:
      "The longest document in the corpus. Every clause type is present, with a wide mix of compliant, marginal and adverse terms.",
    terms: from(COMPLIANT, {
      attrition: { basis: "night_by_night", threshold: 0.85, high_occupancy_credit: false },
      cancellation: { damages_basis: "gross_revenue", rebook_credit: false, liability_free_months: 6, top_tier_pct: 0.9 },
      force_majeure: { standard: "impossible", covers_unsafe_travel: false },
      cutoff_date: { days_prior: 40 },
      walk_relocation: { return_upgrade: false, counts_toward_pickup: false },
      mandatory_fees: { disclosed_before_signature: false, resort_fee_usd: 26 },
      insurance_indemnification: { group_liability_limit_usd: 3000000 },
      master_account_billing: { finance_charge_monthly_pct: 0.015 },
      resale_mitigation_duty: { records_available: false },
      rate_parity: { retroactive_adjustment: false },
      damage_deposit: { deposit_usd: 30000, refund_window_days: 45 },
    }),
  },
];

/**
 * The seven contracts the corpus is actually built from.
 *
 * Chosen for spread rather than by order — one aggressive draft, one almost
 * clean, one thin document that omits half its clauses, one where every
 * deviation is marginal, one that repeats the same percentage across four
 * clauses, one carrying a term in its footer, and one long mixed draft. Each
 * exercises a different way the review can go wrong.
 *
 * The other eight specs are kept rather than deleted. Widening the corpus later
 * is then a matter of moving an id into this list and rebuilding, and the work
 * of deciding what each contract is for does not have to be redone.
 */
const ACTIVE_SPEC_IDS = new Set([
  "eval-01-harborview",
  "eval-03-bayfront",
  "eval-05-riverwalk",
  "eval-07-monarch",
  "eval-10-crossroads",
  "eval-12-granite-bay",
  "eval-15-vantage",
]);

export const EVAL_SPECS: EvalContractSpec[] = ALL_SPECS.filter((s) => ACTIVE_SPEC_IDS.has(s.id));

/** Written, reviewed, and held back from the corpus. Not dead code — see above. */
export const RESERVE_SPECS: EvalContractSpec[] = ALL_SPECS.filter((s) => !ACTIVE_SPEC_IDS.has(s.id));

export const SPEC_BY_ID = new Map(ALL_SPECS.map((s) => [s.id, s]));
