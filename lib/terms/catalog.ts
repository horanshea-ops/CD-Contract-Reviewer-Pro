import type { NumericUnit } from "../quantities";
import type { TermCatalog, TermDefinition } from "./types";

/**
 * The hotel group-contract term catalog (MASTER_PLAN.md §2.0.2).
 *
 * This is the industry layer. It says which terms a hotel contract carries and
 * how each is typed. It says nothing about what a good value is, which is a
 * client's position and lives in the standards library.
 *
 * Each meaning names exactly one figure. Several clauses carry two numbers side
 * by side — a named-storm clause has both a trigger window and a notice
 * deadline — and a meaning loose enough to fit either invites the model to pick
 * the wrong one with a correct-looking quote.
 *
 * Retooling for another vertical means writing another catalog, not changing
 * the extraction code.
 */

const num = (key: string, unit: NumericUnit, meaning: string): TermDefinition => ({ key, kind: "number", unit, meaning });
const bool = (key: string, meaning: string): TermDefinition => ({ key, kind: "boolean", meaning });

export const HOTEL_TERM_CATALOG: TermCatalog = {
  version: "hotel-v1",
  terms: [
    // Deal
    num("deal.peak_night_rooms", "rooms", "Guest rooms held on the peak night of the room block."),
    num("deal.group_rate_usd", "usd", "The group room rate per room, per night, before taxes, for the main room block."),
    { key: "deal.event_start_date", kind: "date", meaning: "The first date of the event, as the agreement states it." },
    { key: "deal.event_end_date", kind: "date", meaning: "The last date of the event, as the agreement states it." },
    num("deal.fb_minimum_usd", "usd", "The total food and beverage minimum the group commits to spend."),

    // Attrition
    {
      key: "attrition.basis",
      kind: "enum",
      options: {
        cumulative: "Attrition is measured across the whole block over the full stay.",
        night_by_night: "Attrition is measured separately for each night.",
      },
      meaning: "How pickup is measured against the block for attrition.",
    },
    num("attrition.threshold", "pct", "The share of the room block the group must pick up before attrition damages apply. 90% means damages start below 90% pickup."),
    num("attrition.liability_rate", "pct", "The share of the room rate the group pays for each room below the attrition threshold. 100% means the full rate."),
    bool("attrition.high_occupancy_credit", "True when the group gets credit toward its block for nights the hotel is sold out or at high occupancy. False when the agreement denies that credit."),
    bool("attrition.audit_rights", "True when the group may review the hotel's occupancy records to check an attrition calculation. False when the hotel's calculation is final or its records are closed to the group."),

    // Cancellation
    {
      key: "cancellation.damages_basis",
      kind: "enum",
      options: {
        room_profit: "Cancellation damages are a percentage of lost room profit.",
        gross_revenue: "Cancellation damages are a percentage of gross room revenue.",
      },
      meaning: "What cancellation damages are calculated from.",
    },
    bool("cancellation.sliding_scale", "True when cancellation damages vary with how far before arrival the group cancels. False when one flat figure applies whenever it cancels."),
    bool("cancellation.resale_credit", "True when revenue from reselling cancelled rooms is credited against cancellation damages. False when the hotel keeps resale revenue with no credit."),
    bool("cancellation.rebook_credit", "True when revenue from a later rebooking at the hotel is credited against cancellation damages. False when rebooking earns no credit."),
    num("cancellation.liability_free_months", "months", "How many months after signing the group may cancel without damages. 0 when damages apply from signature with no liability-free window."),
    num("cancellation.top_tier_pct", "pct", "The damages percentage in the schedule tier closest to arrival, which is the most the group can owe."),
    {
      key: "cancellation.schedule",
      kind: "schedule",
      meaning:
        "The cancellation damages schedule, one tier per band of days before arrival. days_prior_min is the fewest days before arrival the band covers (0 when the band runs up to arrival). days_prior_max is the most days it covers (null for an open-ended earliest band such as \"365 days or more\"). pct is the damages percentage for that band (0 where the band carries no damages).",
    },

    // Force majeure
    {
      key: "force_majeure.standard",
      kind: "enum",
      options: {
        impracticable: "Performance is excused when it is illegal, impossible or commercially impracticable.",
        impossible: "Performance is excused only when it is physically impossible.",
      },
      meaning: "How hard performance must be before force majeure excuses it.",
    },
    bool("force_majeure.covers_government_restrictions", "True when government travel restrictions or advisories count as force majeure. False when they are excluded."),
    bool("force_majeure.covers_epidemic", "True when epidemics or pandemics count as force majeure. False when they are excluded."),
    bool("force_majeure.covers_unsafe_travel", "True when conditions making it unsafe or imprudent for attendees to travel or gather count as force majeure. False when attendee safety concerns do not excuse performance."),
    bool("force_majeure.deposit_refund", "True when deposits are refunded if the agreement ends for force majeure. False when the hotel keeps them."),

    // Food and beverage
    num("fb_minimum.menu_price_lock_months", "months", "How many months before the event the hotel sets menus and pricing for the group."),
    num("fb_minimum.shortfall_rate", "pct", "The share of any shortfall below the food and beverage minimum the group must pay. 100% means the full shortfall."),

    // Cutoff
    num("cutoff_date.days_prior", "days", "How many days before arrival the room block cutoff falls."),
    bool("cutoff_date.post_cutoff_group_rate", "True when reservations after the cutoff are still offered at the group rate, subject to availability. False when they are offered only at the hotel's prevailing rate."),

    // Walk and relocation
    bool("walk_relocation.comparable_accommodation", "True when a relocated guest is placed in comparable or better lodging at the hotel's expense. False when relocation is at the guest's expense or only a best effort."),
    bool("walk_relocation.transportation", "True when the hotel pays transportation between the alternative hotel and the event. False when that is the guest's responsibility."),
    bool("walk_relocation.return_upgrade", "True when a relocated guest returns to an upgraded room or receives an amenity. False when they return to a standard room with nothing extra."),
    bool("walk_relocation.counts_toward_pickup", "True when a relocated night still counts toward the group's pickup and commission. False when it does not."),

    // Mandatory fees
    bool("mandatory_fees.disclosed_before_signature", "True when every mandatory fee or surcharge must be disclosed in writing before signature. False when the hotel may add fees after signature."),
    bool("mandatory_fees.undisclosed_waived", "True when charges not disclosed before signature are waived. False when they remain payable."),
    num("mandatory_fees.resort_fee_usd", "usd", "The resort, amenity or facility fee per room, per night. 0 when the agreement says there is none."),

    // Complimentary rooms
    num("rebates.comp_room_ratio", "rooms", "Paid room nights needed to earn one complimentary room night. 40 means one complimentary room per 40 paid."),
    bool("rebates.formula_based", "True when complimentary rooms accrue automatically from a stated ratio. False when the ratio is only a guideline or complimentary rooms are at the hotel's discretion."),
    bool("rebates.forfeited_on_attrition", "True when complimentary room credit is forfeited if the group falls short of its block. False when credit already earned survives a shortfall."),

    // Construction and renovation
    bool("construction_renovation.no_current_plans_warranty", "True when the hotel warrants it has no renovation planned that would affect the group. False when it makes no such representation."),
    num("construction_renovation.notice_days", "days", "How many days' notice the hotel must give of renovation that affects the group. 0 when it may begin work without notice."),
    bool("construction_renovation.termination_if_interferes", "True when the group may terminate without liability if renovation will interfere with the event. False when renovation gives it no such right."),

    // Master account
    num("master_account_billing.dispute_window_days", "days", "How many days the group has to dispute an invoiced charge. 0 when invoices are due in full with no dispute period."),
    num("master_account_billing.finance_charge_monthly_pct", "pct", "The monthly finance charge on a late balance."),
    bool("master_account_billing.prepayment_defined", "True when, without approved credit, the prepayment due is a stated percentage of anticipated charges. False when the hotel may set the prepayment amount itself."),

    // Reporting and audit
    bool("review_audit_dates.weekly_pickup_reports", "True when the hotel sends the group a written pickup report every week before cutoff. False when pickup information comes only on request."),
    num("review_audit_dates.post_event_report_days", "days", "How many days after the event the hotel must deliver its post-event report."),
    bool("review_audit_dates.block_audit_right", "True when the group may audit the room block. False when it has no such right."),

    // Insurance and indemnification
    bool("insurance_indemnification.mutual", "True when each party indemnifies the other on the same terms. False when only the group gives an indemnity."),
    bool("insurance_indemnification.own_negligence_only", "True when each party's indemnity is limited to its own negligence or misconduct. False when the group's indemnity covers the hotel's own negligence."),
    num("insurance_indemnification.group_liability_limit_usd", "usd", "The general liability insurance limit the group must carry."),

    // Damage deposit
    num("damage_deposit.refund_window_days", "days", "How many days after the event the hotel must refund the damage deposit."),
    bool("damage_deposit.offsets_other_charges", "True when the hotel may apply the damage deposit to amounts other than damage, such as attrition or food and beverage shortfalls. False when it covers documented damage only."),
    num("damage_deposit.deposit_usd", "usd", "The damage deposit amount. 0 when the agreement says none is charged."),

    // Vendors
    bool("exclusivity_vendors.outside_vendors_allowed", "True when the group may use its own vendors for services such as audio-visual, decorating, security or transportation. False when it must use the hotel's in-house or exclusive vendors."),
    num("exclusivity_vendors.opt_out_fee_usd", "usd", "The surcharge for using an outside vendor. 0 when the agreement says there is none."),

    // Termination
    bool("termination_rights.for_cause_no_liability", "True when the group may terminate for cause without liability. False when damages still apply after termination for cause."),
    bool("termination_rights.separate_from_cancellation_scale", "True when termination for cause does not trigger the cancellation damages scale. False when any termination is treated as a cancellation."),

    // Assignment
    bool("assignment_subcontracting.assignable_to_successor", "True when the group may assign the agreement to a successor or affiliated entity. False when it may not assign it."),
    bool("assignment_subcontracting.consent_not_unreasonably_withheld", "True when the hotel's consent to an assignment will not be unreasonably withheld. False when it may refuse for any reason."),

    // Brand and ownership
    num("brand_ownership_change.notice_days", "days", "How many days after a change of brand, management or ownership the hotel must notify the group."),
    num("brand_ownership_change.termination_window_days", "days", "How many days the group has after that notice to terminate without liability."),
    bool("brand_ownership_change.covers_bankruptcy", "True when bankruptcy or foreclosure triggers the same notice and termination rights as a change of brand. False when it does not."),

    // Named storm
    num("named_storm.cancellation_window_hours", "hours", "How many hours the group has to give cancellation notice once a qualifying storm watch or warning is issued. Not the period before arrival in which the warning must fall."),

    // Attendee data
    bool("attendee_data_handling.marketing_use_barred", "True when the hotel may not use attendee data for its own marketing. False when it may."),
    bool("attendee_data_handling.third_party_sale_barred", "True when the hotel may not sell or share attendee data with third parties. False when it may share it."),

    // Accessibility
    bool("ada_compliance.hotel_warranty", "True when the hotel warrants its rooms, public areas and function space comply with the Americans with Disabilities Act. False when it gives no such warranty."),
    bool("ada_compliance.auxiliary_aids_split", "True when the cost of auxiliary aids is shared between the group and the hotel. False when the group pays for all of them."),

    // Governing law
    {
      key: "governing_law_venue.venue",
      kind: "enum",
      options: {
        group_state: "The law of the state where the group has its principal offices governs.",
        hotel_state: "The law of the state where the hotel is located governs.",
      },
      meaning: "Which state's law governs the agreement.",
    },
    bool("governing_law_venue.punitive_damages_barred", "True when neither party may recover punitive damages. False when the hotel may."),
    bool("governing_law_venue.each_party_own_fees", "True when each party bears its own attorney's fees. False when the group pays the hotel's."),

    // Labor disputes
    num("labor_disputes.cba_expiry_notice_months", "months", "How many months' notice the hotel gives of its collective bargaining agreements expiring. 0 when the agreement says it gives none."),
    num("labor_disputes.cancel_window_days", "days", "The period before the event, in days, within which a labor dispute lets the group cancel. 90 means a dispute arising within 90 days of the event qualifies. 0 when the agreement says no such period is defined."),
    bool("labor_disputes.cancel_no_liability", "True when the group may cancel without liability if a labor dispute affects the hotel. False when a labor dispute relieves it of nothing."),

    // Rate parity
    bool("rate_parity.guaranteed", "True when the hotel will not offer the public a lower rate than the group's during the event dates. False when it may."),
    bool("rate_parity.retroactive_adjustment", "True when a lower public rate triggers a matching adjustment, including for reservations already made. False when an adjustment applies only to later reservations."),
    bool("rate_parity.commission_preserved", "True when commission and pickup credit survive a rate adjustment. False when an adjusted rate is non-commissionable or does not count toward pickup."),

    // Gratuity and service charge
    bool("gratuity_service_charge.separately_defined", "True when gratuity and service charge are defined separately, each with its own purpose. False when the terms are used interchangeably."),
    bool("gratuity_service_charge.gratuity_to_staff", "True when gratuity goes in full to the staff who worked the event. False when the hotel may allocate or keep it."),
    bool("gratuity_service_charge.service_charge_disclosed", "True when the agreement says the service charge is the hotel's own revenue and not a tip to staff. False when the agreement expressly leaves where the money goes unstated or open."),
    num("gratuity_service_charge.service_charge_pct", "pct", "The service charge percentage added to food and beverage."),

    // Resale and mitigation
    bool("resale_mitigation_duty.affirmative_duty", "True when the hotel must actively try to resell released rooms or function space. False when it has no such obligation."),
    bool("resale_mitigation_duty.proceeds_credited", "True when resale proceeds are credited against what the group owes. False when the hotel keeps them as well."),
    bool("resale_mitigation_duty.records_available", "True when the hotel makes its resale records available to the group. False when they are closed to it."),
  ],
};

export const termGroup = (key: string) => key.slice(0, key.indexOf("."));

export function catalogIndex(catalog: TermCatalog): Map<string, TermDefinition> {
  return new Map(catalog.terms.map((t) => [t.key, t]));
}
