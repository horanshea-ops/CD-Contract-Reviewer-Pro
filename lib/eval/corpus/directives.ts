import type { ClauseFieldDirective } from "../../anthropic";
import { phrase } from "../phrasing";
import type { ClauseTerms, TermCheck } from "./spec";
import { POSITION_BY_CLAUSE } from "./positions";
import { isTableOnly } from "./layout";

/**
 * Turning a spec's term values into drafting instructions (MASTER_PLAN.md §2.0.1).
 *
 * Numbers and enums are dictated word for word, because their exact wording is
 * what the verification gate checks by substring and what the answer key's
 * numeric assertions are measured against. Booleans are given as MEANING and
 * left to the drafter's own words.
 *
 * That split is deliberate. Dictating every sentence would make fifteen
 * contracts that differ only in their figures, and a model reading its
 * fifteenth identical clause is not being tested on anything. Booleans are
 * where the wording can safely vary, so they are where it does — and the
 * read-back pass in ./draft.ts is what confirms the varied wording still says
 * what the spec says.
 */

/** What each boolean field means, in both polarities. The corpus's plain-language ground truth. */
const BOOLEAN_MEANING: Record<string, { true: string; false: string }> = {
  "attrition.high_occupancy_credit": {
    true: "Group receives full credit toward its block commitment for any night the Hotel reaches 95% occupancy or higher.",
    false: "Group receives no credit toward its block commitment for nights on which the Hotel sells out.",
  },
  "attrition.audit_rights": {
    true: "Group may request the Hotel's occupancy records to verify how attrition damages were calculated.",
    false: "The Hotel's calculation of attrition damages is final and its occupancy records are not open to Group.",
  },
  "cancellation.sliding_scale": {
    true: "Damages vary by how far before arrival the cancellation notice is given.",
    false: "A single flat damages figure applies no matter when Group cancels.",
  },
  "cancellation.resale_credit": {
    true: "Revenue the Hotel earns reselling cancelled rooms is credited against what Group owes.",
    false: "The Hotel keeps any revenue it earns reselling cancelled rooms, with no credit to Group.",
  },
  "cancellation.rebook_credit": {
    true: "If Group books another event at the Hotel within a year, that revenue is credited against the damages paid.",
    false: "Rebooking with the Hotel later earns Group no credit against damages already owed.",
    },
  "force_majeure.covers_government_restrictions": {
    true: "Government-imposed travel restrictions and advisories are a force majeure event.",
    false: "Government-imposed travel restrictions and advisories are expressly excluded from force majeure.",
  },
  "force_majeure.covers_epidemic": {
    true: "Epidemics and pandemics are a force majeure event.",
    false: "Epidemics, pandemics and public-health emergencies are expressly excluded from force majeure.",
  },
  "force_majeure.covers_unsafe_travel": {
    true: "Conditions making it unsafe or imprudent for attendees to travel or gather are a force majeure event.",
    false: "Concerns about attendee safety or willingness to travel do not excuse performance.",
  },
  "force_majeure.deposit_refund": {
    true: "Deposits are refunded promptly when the agreement ends for force majeure.",
    false: "Deposits are retained by the Hotel even when the agreement ends for force majeure.",
  },
  "cutoff_date.post_cutoff_group_rate": {
    true: "Reservations requested after the cutoff are still offered at the group rate, subject to availability.",
    false: "Reservations requested after the cutoff are offered only at the Hotel's prevailing rack rate.",
  },
  "walk_relocation.comparable_accommodation": {
    true: "A relocated guest is placed in a comparable or better hotel at the Hotel's expense.",
    false: "The Hotel will make a reasonable effort to find alternative lodging, at the guest's own expense.",
  },
  "walk_relocation.transportation": {
    true: "The Hotel pays round-trip transportation between the alternative hotel and the event.",
    false: "Transportation to and from any alternative hotel is the guest's own responsibility.",
  },
  "walk_relocation.return_upgrade": {
    true: "A relocated guest returns to an upgraded room with a welcome amenity.",
    false: "A relocated guest returns to a standard room with no upgrade or amenity.",
  },
  "walk_relocation.counts_toward_pickup": {
    true: "A relocated night still counts toward Group's pickup and commission.",
    false: "A relocated night does not count toward Group's pickup or commission.",
  },
  "mandatory_fees.disclosed_before_signature": {
    true: "Every mandatory fee and surcharge the Hotel intends to bill is disclosed in writing before signature.",
    false: "The Hotel may introduce additional fees, surcharges and service charges after signature at its discretion.",
  },
  "mandatory_fees.undisclosed_waived": {
    true: "Any charge not disclosed before signature is waived.",
    false: "Charges not disclosed before signature remain payable by Group.",
  },
  "rebates.formula_based": {
    // Both polarities have to sit alongside the ratio the clause also states.
    // "Awarded at the Hotel's discretion" alone contradicted a stated ratio,
    // and the read-back reader was right to call that a formula.
    true: "The complimentary room ratio stated above accrues automatically, and Group is entitled to those rooms.",
    false: "The complimentary room ratio stated above is a guideline only, and any complimentary rooms are awarded at the Hotel's sole discretion.",
  },
  "rebates.forfeited_on_attrition": {
    true: "Complimentary room credit is forfeited entirely if Group falls short of its block.",
    false: "Complimentary room credit already earned is not affected by any attrition shortfall.",
  },
  "construction_renovation.no_current_plans_warranty": {
    true: "The Hotel warrants that it has no renovation planned that would affect Group's rooms or space.",
    false: "The Hotel makes no representation about renovation work planned or under way during the event.",
  },
  "construction_renovation.termination_if_interferes": {
    true: "Group may terminate without liability if renovation will interfere with the event.",
    false: "Renovation work is not grounds for Group to terminate or to claim any remedy.",
  },
  "master_account_billing.prepayment_defined": {
    true: "Where credit is not approved, the prepayment due is a stated percentage of the anticipated charges.",
    false: "Where credit is not approved, the Hotel may require prepayment in whatever amount it determines.",
  },
  "review_audit_dates.weekly_pickup_reports": {
    true: "The Hotel provides Group a written pickup report each week in the run-up to cutoff.",
    false: "The Hotel provides pickup information only on request and at its convenience.",
  },
  "review_audit_dates.block_audit_right": {
    true: "Group may audit the room block at no cost, and miscoded rooms are credited to Group's pickup.",
    false: "The Hotel's pickup figures are final and Group has no right to audit the block.",
  },
  "insurance_indemnification.mutual": {
    true: "Each party indemnifies the other on the same terms.",
    false: "Group indemnifies the Hotel, and the Hotel gives no indemnity in return.",
  },
  "insurance_indemnification.own_negligence_only": {
    true: "Each party's indemnity is limited to its own negligence or willful misconduct.",
    false: "Group's indemnity extends to claims arising from the Hotel's own negligence.",
  },
  "damage_deposit.offsets_other_charges": {
    true: "The Hotel may apply the deposit against attrition, food and beverage shortfalls or any other amount owed.",
    false: "The deposit is applied only to documented damage and to nothing else.",
  },
  "exclusivity_vendors.outside_vendors_allowed": {
    true: "Group may engage its own audio-visual, decorating, security and transportation vendors.",
    false: "Group must use the Hotel's in-house or exclusively appointed vendors for those services.",
  },
  "termination_rights.for_cause_no_liability": {
    true: "Termination for cause leaves Group with no liability and brings a prompt refund of deposits.",
    false: "Group remains liable for damages even where it terminates for cause.",
  },
  "termination_rights.separate_from_cancellation_scale": {
    true: "Termination for cause is separate from the cancellation clause and does not trigger its damages scale.",
    false: "Any termination by Group, whatever its cause, is treated as a cancellation under the damages scale.",
  },
  "assignment_subcontracting.assignable_to_successor": {
    true: "Group may assign the agreement to a successor or affiliated management entity.",
    false: "Group may not assign the agreement under any circumstances.",
  },
  "assignment_subcontracting.consent_not_unreasonably_withheld": {
    true: "The Hotel's consent to an assignment will not be unreasonably withheld.",
    false: "The Hotel may withhold consent to an assignment for any reason or none.",
  },
  "brand_ownership_change.covers_bankruptcy": {
    true: "Bankruptcy and foreclosure trigger the same notice and termination rights as a change of brand.",
    false: "Bankruptcy and foreclosure give Group no notice or termination right.",
  },
  "attendee_data_handling.marketing_use_barred": {
    true: "The Hotel will not use attendee data for its own marketing.",
    false: "The Hotel may use attendee data for its own marketing.",
  },
  "attendee_data_handling.third_party_sale_barred": {
    true: "The Hotel will not sell or share attendee data with third parties.",
    false: "The Hotel may share attendee data with its affiliates and marketing partners.",
  },
  "ada_compliance.hotel_warranty": {
    true: "The Hotel warrants that its guest rooms, public areas and function space comply with the Americans with Disabilities Act.",
    false: "The Hotel gives no warranty of accessibility, and compliance is Group's responsibility.",
  },
  "ada_compliance.auxiliary_aids_split": {
    true: "Group funds auxiliary aids in its own event space and the Hotel funds them in guest rooms and public areas.",
    false: "Group funds all auxiliary aids, wherever in the Hotel they are required.",
  },
  "governing_law_venue.punitive_damages_barred": {
    true: "Neither party may recover punitive damages.",
    false: "The Hotel may recover punitive damages in addition to its actual damages.",
  },
  "governing_law_venue.each_party_own_fees": {
    true: "Each party bears its own attorney's fees.",
    false: "Group pays the Hotel's attorney's fees in any dispute arising under the agreement.",
  },
  "labor_disputes.cancel_no_liability": {
    true: "Group may cancel with no liability where a labor dispute affects the Hotel.",
    false: "A labor dispute at the Hotel does not relieve Group of any obligation.",
  },
  "rate_parity.guaranteed": {
    true: "The Hotel will not offer the general public a lower rate than Group's during the event dates.",
    false: "The Hotel may sell rooms to the public at any rate, including below Group's rate.",
  },
  "rate_parity.retroactive_adjustment": {
    true: "If a lower public rate appears, Group's rate is adjusted to match, including for reservations already made.",
    false: "Any rate adjustment applies only to reservations made after the lower rate is identified.",
  },
  "rate_parity.commission_preserved": {
    true: "Commission and pickup credit are unaffected by any rate adjustment.",
    false: "An adjusted rate is treated as non-commissionable and does not count toward pickup.",
  },
  "gratuity_service_charge.separately_defined": {
    true: "Gratuity and service charge are defined separately, each with its own stated purpose.",
    false: "Gratuity and service charge are referred to interchangeably and are not separately defined.",
  },
  "gratuity_service_charge.gratuity_to_staff": {
    true: "Gratuity is distributed in full to the staff who worked the event.",
    false: "The Hotel determines how any gratuity is allocated, and it may be retained by the Hotel.",
  },
  "gratuity_service_charge.service_charge_disclosed": {
    // About what the clause says the charge IS, not whether its size is stated.
    // The percentage is always stated, so a meaning turning on disclosure of
    // the figure read as satisfied whichever polarity the spec chose.
    true: "The agreement states that the service charge is the Hotel's own revenue and is not a tip to staff.",
    false: "The agreement does not say whether the service charge is the Hotel's revenue or whether any of it reaches the staff.",
  },
  "resale_mitigation_duty.affirmative_duty": {
    true: "The Hotel must actively try to resell released rooms and function space.",
    false: "The Hotel has no obligation to try to resell released rooms or function space.",
  },
  "resale_mitigation_duty.proceeds_credited": {
    true: "Proceeds of any resale are credited against what Group owes.",
    false: "Proceeds of any resale are retained by the Hotel in addition to what Group owes.",
  },
  "resale_mitigation_duty.records_available": {
    true: "The Hotel makes its resale records available to Group on request.",
    false: "The Hotel's resale efforts and records are not open to Group.",
  },
};

/** Enum values, dictated word for word — these carry the key's phrase assertions. */
const ENUM_WORDING: Record<string, Record<string, string>> = {
  "attrition.basis": {
    cumulative: "Attrition is measured on a cumulative basis across the entire room block",
    night_by_night: "Attrition is measured on a night-by-night basis",
  },
  "cancellation.damages_basis": {
    room_profit: "calculated as a percentage of lost room profit",
    gross_revenue: "calculated as a percentage of gross room revenue",
  },
  "force_majeure.standard": {
    impracticable: "illegal, impossible or commercially impracticable",
    impossible: "physically impossible",
  },
  "governing_law_venue.venue": {
    group_state: "governed by the laws of the state in which Group maintains its principal offices",
    hotel_state: "governed by the laws of the state in which the Hotel is located",
  },
};

/** Fields whose value is a bare figure the clause states in passing. */
const STATED_UNITS: Record<string, "usd" | "pct"> = {
  "mandatory_fees.resort_fee_usd": "usd",
  "damage_deposit.deposit_usd": "usd",
  "gratuity_service_charge.service_charge_pct": "pct",
  "cancellation.top_tier_pct": "pct",
};

/**
 * A duration of zero is a meaning, not a figure.
 *
 * "State the liability-free cancellation window as zero (0) months" produces a
 * sentence no contract would contain. What the term actually says is that there
 * is no such window, so that is what the drafter is asked for — and the field
 * loses its dictated wording, which the read-back pass covers instead.
 */
const ZERO_DURATION_MEANING: Record<string, string> = {
  "cancellation.liability_free_months":
    "liquidated damages apply to a cancellation at any time after signature, with no liability-free window",
  "construction_renovation.notice_days":
    "the Hotel may begin renovation work without giving Group any advance notice",
  "master_account_billing.dispute_window_days":
    "invoiced amounts must be paid in full when due, with no period in which Group may dispute a charge",
  "labor_disputes.cba_expiry_notice_months":
    "the Hotel gives no advance notice of when its collective bargaining agreements expire",
  "labor_disputes.cancel_window_days":
    "no period is defined in which a labor dispute would let Group cancel",
};

function numericDirective(
  key: string,
  check: Extract<TermCheck, { kind: "number" }>,
  value: number
): string {
  const zeroMeaning = value === 0 ? ZERO_DURATION_MEANING[key] : undefined;
  if (zeroMeaning) return `Say, in your own words, that ${zeroMeaning}.`;
  return `State the ${check.label} as "${phrase(value, check.unit)}". Reproduce that wording verbatim.`;
}

/**
 * Directives for one clause, in the order its fields are declared.
 *
 * A field whose value the layout supplies instead of the prose is skipped, and
 * the drafter is told to leave it alone — the cancellation schedule lives in a
 * table, and a percentage stated in both places would give a correct finding a
 * second place to quote from that the key does not know about.
 */
export function buildDirectives(clauseType: string, terms: ClauseTerms): ClauseFieldDirective[] {
  const position = POSITION_BY_CLAUSE.get(clauseType);
  if (!position) throw new Error(`No CD position transcribed for clause type "${clauseType}".`);

  const out: ClauseFieldDirective[] = [];

  for (const check of position.checks) {
    if (isTableOnly(clauseType, check.field)) continue;
    const value = terms[check.field];
    const key = `${clauseType}.${check.field}`;

    if (check.kind === "number") {
      if (typeof value !== "number") throw new Error(`${key} must be a number, got ${typeof value}.`);
      out.push({ field: check.field, label: check.label, directive: numericDirective(key, check, value) });
      continue;
    }

    if (check.kind === "enum") {
      const wording = ENUM_WORDING[key]?.[String(value)];
      if (!wording) throw new Error(`No dictated wording for ${key} = "${value}".`);
      out.push({
        field: check.field,
        label: check.label,
        directive: `The clause must contain the wording "${wording}", verbatim, in a sentence of your own.`,
      });
      continue;
    }

    const meaning = BOOLEAN_MEANING[key];
    if (!meaning) throw new Error(`No meaning written for boolean field ${key}.`);
    out.push({
      field: check.field,
      label: check.label,
      // Meaning, not wording. Fifteen contracts repeating one sentence would
      // stop testing anything by the third.
      directive: `Say, in your own words: ${value === true ? meaning.true : meaning.false}`,
    });
  }

  for (const field of position.stated ?? []) {
    const key = `${clauseType}.${field}`;
    if (isTableOnly(clauseType, field)) continue;

    const value = terms[field];
    const unit = STATED_UNITS[key];
    if (!unit) throw new Error(`No unit declared for stated field ${key}.`);
    if (typeof value !== "number") throw new Error(`${key} must be a number, got ${typeof value}.`);

    // A zero here means the contract has no such charge, which is a fact about
    // the clause and has to be stated rather than left out.
    if (value === 0) {
      out.push({
        field,
        label: field,
        directive: `State that the Hotel charges no ${field.replace(/_(usd|pct)$/, "").replace(/_/g, " ")}.`,
      });
      continue;
    }

    out.push({
      field,
      label: field,
      directive: `State the ${field.replace(/_(usd|pct)$/, "").replace(/_/g, " ")} as "${phrase(value, unit)}". Reproduce that wording verbatim.`,
    });
  }

  return out;
}

/**
 * The exact wording a field's drafted sentence must contain, or null where the
 * drafter was given meaning rather than words.
 */
export function requiredWording(clauseType: string, field: string, terms: ClauseTerms): string | null {
  const position = POSITION_BY_CLAUSE.get(clauseType)!;
  const key = `${clauseType}.${field}`;
  const value = terms[field];

  const check = position.checks.find((c) => c.field === field);
  if (check?.kind === "number" && typeof value === "number") {
    // A zero duration was drafted as meaning, so there is no wording to check.
    if (value === 0 && ZERO_DURATION_MEANING[key]) return null;
    return phrase(value, check.unit);
  }
  if (check?.kind === "enum") return ENUM_WORDING[key]?.[String(value)] ?? null;
  if (check?.kind === "boolean") return null;

  const unit = STATED_UNITS[key];
  if (unit && typeof value === "number" && value !== 0) return phrase(value, unit);
  return null;
}

/**
 * The plain-English note a field was described with, where it was described
 * rather than dictated. The gate checks the drafted sentence is not this note
 * with a full stop on the end — a corpus that repeats its own instructions is a
 * template, and reading the fifteenth copy of one tests nothing.
 */
export function meaningNote(clauseType: string, field: string, terms: ClauseTerms): string | null {
  const key = `${clauseType}.${field}`;
  const value = terms[field];

  const meaning = BOOLEAN_MEANING[key];
  if (meaning) return value === true ? meaning.true : meaning.false;

  if (value === 0 && ZERO_DURATION_MEANING[key]) return ZERO_DURATION_MEANING[key];
  return null;
}

export { BOOLEAN_MEANING, ENUM_WORDING };
