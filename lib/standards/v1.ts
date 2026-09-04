import { StandardEntry } from "./types";

/**
 * STAGE 1 — industry_default.
 *
 * Seeded from published hospitality contracting practice, not from CD's actual
 * negotiated positions. This is scaffolding to exercise the pipeline end to
 * end. It must never be presented to an associate as "how ConferenceDirect
 * negotiates" — see the provenance field and §7.1 of the build brief.
 */
export const STANDARDS_LIBRARY_VERSION = "v1-industry-default";

export const STANDARDS_LIBRARY: StandardEntry[] = [
  {
    clause_type: "attrition",
    segment: "default",
    position:
      "Attrition should be measured cumulatively across the room block, not night-by-night, with a threshold no lower than 80% of the block before any liability attaches. Liquidated damages should be capped at lost profit (room revenue minus avoided costs), not full retail rate.",
    fallback_language:
      "Attrition liability, if any, will be calculated on a cumulative (not night-by-night) basis measured against 80% of the total contracted room block. Liability is limited to the Hotel's actual lost profit, calculated as the unrealized room revenue less avoided variable costs (estimated at 25% of ADR), less any revenue from rooms resold at any rate during the contracted dates.",
    walk_away_condition: "",
    severity_default: "high",
    version: "v1-industry-default",
    provenance: "industry_default",
  },
  {
    clause_type: "cancellation",
    segment: "default",
    position:
      "Cancellation damages should be a sliding scale tied to how close to the event the cancellation occurs and should be calculated as lost profit, not gross room and F&B revenue. There should be no cancellation fee at all outside a defined window before arrival.",
    fallback_language:
      "In the event of cancellation, liquidated damages will be calculated as a percentage of anticipated lost profit (not gross revenue) on a sliding scale based on the number of days prior to arrival, with no liability for cancellation more than 12 months prior to the arrival date.",
    walk_away_condition: "",
    severity_default: "high",
    version: "v1-industry-default",
    provenance: "industry_default",
  },
  {
    clause_type: "force_majeure",
    segment: "default",
    position:
      "Force majeure language should allow either party to cancel without penalty when performance is made illegal, impossible, or commercially impracticable, and should explicitly include: government-imposed travel restrictions or advisories, epidemics/pandemics, and events that make it unsafe or imprudent for attendees to travel or gather — not just physical destruction of the venue.",
    fallback_language:
      "Either party may cancel this Agreement without liability if performance is rendered illegal, impossible, or commercially impracticable by fire, natural disaster, war, terrorism, government regulation or advisory, epidemic or pandemic, or other emergency, including circumstances that make it unsafe, illegal, or imprudent for attendees to travel to or assemble at the Hotel.",
    walk_away_condition: "",
    severity_default: "high",
    version: "v1-industry-default",
    provenance: "industry_default",
  },
  {
    clause_type: "fb_minimum",
    segment: "default",
    position:
      "Food and beverage minimums should be achievable through actual spend including service charge and gratuity where customary, and should include a mechanism (e.g. a la carte credit or reduced minimum) if attendance drops below contracted room block by a material amount.",
    fallback_language:
      "The Food and Beverage minimum will be reduced proportionally if actual room pickup falls below 90% of the contracted room block. Service charge and gratuity apply toward satisfaction of the minimum. Any unmet minimum, if applicable, will be billed at the actual menu price of unconsumed items, not a flat penalty.",
    walk_away_condition: "",
    severity_default: "medium",
    version: "v1-industry-default",
    provenance: "industry_default",
  },
  {
    clause_type: "cutoff_date",
    segment: "default",
    position:
      "The room block cutoff date should be no earlier than 21-30 days prior to arrival, and reservations after cutoff should remain available at the group rate subject to availability rather than automatically reverting to rack rate.",
    fallback_language:
      "The cutoff date for the room block will be twenty-one (21) days prior to the group's arrival date. After the cutoff date, the Hotel will continue to accept reservations at the group rate on a space-available basis.",
    walk_away_condition: "",
    severity_default: "medium",
    version: "v1-industry-default",
    provenance: "industry_default",
  },
  {
    clause_type: "walk_relocation",
    segment: "default",
    position:
      "If the hotel walks (relocates) a guaranteed reservation, it should be responsible for comparable or better accommodations, all transportation costs, one night's stay, and a phone call/message to notify the guest, at no cost to the guest or group.",
    fallback_language:
      "If the Hotel is unable to provide confirmed accommodations to any guest holding a guaranteed reservation, the Hotel will, at its sole expense: (a) provide accommodations for one night at a comparable or higher-rated hotel; (b) provide transportation to and from that hotel; (c) provide one free phone call or message to notify the guest's family or office; and (d) pay the difference in room rate, if any, for the duration of the guest's stay, with the guest returned to the contracted Hotel as soon as space is available at no additional cost.",
    walk_away_condition: "",
    severity_default: "high",
    version: "v1-industry-default",
    provenance: "industry_default",
  },
  {
    clause_type: "mandatory_fees",
    segment: "default",
    position:
      "All mandatory fees (resort fees, service charges, energy surcharges, etc.) should be disclosed in full, itemized, and fixed for the life of the contract. Nothing should be added post-signature.",
    fallback_language:
      "All mandatory fees, service charges, and surcharges applicable to this Agreement are itemized in Exhibit A and are fixed for the term of this Agreement. No additional mandatory fee may be added after execution of this Agreement.",
    walk_away_condition: "",
    severity_default: "medium",
    version: "v1-industry-default",
    provenance: "industry_default",
  },
  {
    clause_type: "rebates",
    segment: "default",
    position:
      "Any commission, rebate, or amenity earned by the group or its planner (e.g. planner points, complimentary rooms, VIP amenities, or a cash rebate tied to actual pickup or spend) should be stated in specific, unconditional terms — not left to the Hotel's discretion — and should not be forfeited or reduced because of attrition that the Hotel itself is already being compensated for elsewhere in the contract.",
    fallback_language:
      "The Hotel will provide [1 complimentary room per 40 rooms picked up / a rebate of $X per occupied room night], calculated on actual room nights picked up regardless of whether the contracted block was met, payable within 30 days of the group's departure.",
    walk_away_condition: "",
    severity_default: "low",
    version: "v1-industry-default",
    provenance: "industry_default",
  },
  {
    clause_type: "construction_renovation",
    segment: "default",
    position:
      "If the Hotel has, or later schedules, construction or renovation that could affect guest rooms, meeting space, common areas, or noise/access during the event dates, that must be disclosed in the contract, with a right for the Group to cancel without penalty (or receive a rate reduction) if undisclosed construction materially affects the event.",
    fallback_language:
      "The Hotel represents that no construction, renovation, or remodeling affecting guest rooms, meeting space, or common areas is scheduled during the event dates. Should the Hotel commence any such work that materially impacts the Group's use of the property, Group may cancel this Agreement without liability, or negotiate a rate reduction, at Group's sole option.",
    walk_away_condition: "",
    severity_default: "medium",
    version: "v1-industry-default",
    provenance: "industry_default",
  },
  {
    clause_type: "master_account_billing",
    segment: "default",
    position:
      "Master account payment terms should give the Group a reasonable window after departure to review and dispute charges (30 days is standard) before late fees apply, an itemized folio, and a single point of contact for billing disputes. Direct-bill or credit application should be available for groups with an established payment history.",
    fallback_language:
      "All charges to the Group master account will be itemized and provided to the Group's authorized signatory within 5 business days of departure. Group will have thirty (30) days from receipt of the final itemized invoice to review and dispute any charge in good faith before any late fee accrues. Disputed charges will not accrue late fees while under review.",
    walk_away_condition: "",
    severity_default: "medium",
    version: "v1-industry-default",
    provenance: "industry_default",
  },
  {
    clause_type: "review_audit_dates",
    segment: "default",
    position:
      "The contract should specify concrete checkpoint dates (e.g. 6 months, 90 days, 30 days prior to arrival) at which room pickup, F&B commitments, and other benchmarks are jointly reviewed — giving the Group visibility and a chance to course-correct — rather than leaving attrition and minimums to be assessed only after the fact at the event's conclusion.",
    fallback_language:
      "The parties will jointly review room block pickup and food & beverage commitments at 180, 90, and 30 days prior to the arrival date. Neither party will unilaterally assess attrition, cancellation damages, or unmet minimums except as measured against the final status as of the event's conclusion.",
    walk_away_condition: "",
    severity_default: "low",
    version: "v1-industry-default",
    provenance: "industry_default",
  },
  {
    clause_type: "insurance_indemnification",
    segment: "default",
    position:
      "The group should not indemnify the hotel for the hotel's own negligence — indemnification should be mutual and limited to each party's own acts or omissions. Any requirement that the group carry liability insurance and name the hotel as additional insured should be proportionate to the size of the event, not an open-ended minimum.",
    fallback_language:
      "Each party shall indemnify, defend, and hold harmless the other party from claims arising out of the indemnifying party's negligence or willful misconduct. Neither party indemnifies the other for that other party's own negligence. Group shall maintain commercial general liability insurance with limits appropriate to the size of the event and shall name Hotel as an additional insured on a certificate of insurance provided prior to arrival.",
    walk_away_condition: "",
    severity_default: "high",
    version: "v1-industry-default",
    provenance: "industry_default",
  },
  {
    clause_type: "damage_deposit",
    segment: "default",
    position:
      "Any security or damage deposit should be reasonable relative to the event's size and scope, refundable within a defined window (30 days is standard) absent documented, itemized damage, and should not be commingled with or used to offset unrelated charges like attrition or F&B minimums.",
    fallback_language:
      "Any security deposit collected under this Agreement will be refunded in full within thirty (30) days of the event's conclusion unless the Hotel provides Group with an itemized accounting of specific, documented damage caused by Group or its attendees beyond normal wear and tear. The deposit may not be applied toward attrition, cancellation, or F&B minimum shortfalls.",
    walk_away_condition: "",
    severity_default: "medium",
    version: "v1-industry-default",
    provenance: "industry_default",
  },
  {
    clause_type: "exclusivity_vendors",
    segment: "default",
    position:
      "Mandatory use of in-house AV, catering, decor, or other vendors should be disclosed up front with pricing available before signature, not discovered later. Where exclusivity is required, the group should retain the right to bring in outside vendors for a reasonable fee rather than an outright prohibition, and any such fee should be disclosed in the contract.",
    fallback_language:
      "Group may engage outside vendors for audio-visual, decor, and similar services, subject to the Hotel's standard vendor policies and a reasonable outside-vendor fee of no more than [X]%, disclosed here in full. The Hotel's in-house vendors are not mandatory for any service category not explicitly identified as exclusive in this Agreement.",
    walk_away_condition: "",
    severity_default: "medium",
    version: "v1-industry-default",
    provenance: "industry_default",
  },
  {
    clause_type: "termination_rights",
    segment: "default",
    position:
      "Termination for cause (material breach by the other party, such as failure to deliver contracted space or services) should be available to the group without triggering cancellation liquidated damages. Termination for convenience should follow the cancellation clause's sliding scale rather than a separate, harsher standard.",
    fallback_language:
      "Group may terminate this Agreement without liability upon Hotel's material breach, including failure to provide contracted room block, meeting space, or services, if such breach is not cured within [X] days of written notice. Termination for convenience is governed exclusively by the cancellation clause of this Agreement.",
    walk_away_condition: "",
    severity_default: "medium",
    version: "v1-industry-default",
    provenance: "industry_default",
  },
  {
    clause_type: "assignment_subcontracting",
    segment: "default",
    position:
      "The group should be able to assign the contract to a successor management company or affiliated entity (common for associations that rotate management) without the hotel's consent being unreasonably withheld, particularly where the event itself is unchanged.",
    fallback_language:
      "Group may assign this Agreement to a successor association management company or affiliated entity without Hotel's consent, provided the assignee assumes all obligations under this Agreement and the event dates, room block, and program remain substantially unchanged. Any other assignment requires Hotel's consent, not to be unreasonably withheld.",
    walk_away_condition: "",
    severity_default: "low",
    version: "v1-industry-default",
    provenance: "industry_default",
  },
  {
    clause_type: "brand_ownership_change",
    segment: "default",
    position:
      "If the property changes brand flag, management company, or ownership between signing and the event in a way that materially changes the product the group contracted for, the group should have the right to cancel without penalty or renegotiate — this is not covered by construction/renovation language and shouldn't be assumed to be.",
    fallback_language:
      "Should the Hotel change brand affiliation, management company, or ownership prior to the event in a manner that materially changes the quality, standards, or amenities of the property from those represented at signing, Group may cancel this Agreement without liability upon written notice to Hotel.",
    walk_away_condition: "",
    severity_default: "medium",
    version: "v1-industry-default",
    provenance: "industry_default",
  },
  {
    clause_type: "named_storm",
    segment: "default",
    position:
      "In coastal and hurricane-belt markets, force majeure language is often supplemented by a separate, narrower named-storm clause with its own notice period and cancellation window, since general force majeure language may not clearly cover a storm that threatens but does not destroy the property. This should be evaluated as its own clause, not assumed to be covered by general force majeure.",
    fallback_language:
      "In the event a named storm (hurricane, tropical storm) is forecast to affect the Hotel's location within 72 hours of any event date, either party may cancel the affected portion of the event without liability upon written or verbal (followed by written) notice, regardless of whether the storm ultimately causes physical damage to the Hotel.",
    walk_away_condition: "",
    severity_default: "medium",
    version: "v1-industry-default",
    provenance: "industry_default",
  },
  {
    clause_type: "attendee_data_handling",
    segment: "default",
    position:
      "Rooming list and attendee data provided to the hotel for reservation purposes should not be used by the hotel for its own marketing or sold to third parties without the group's consent. This is distinct from CD's own client-confidentiality question but sits in the same family of concerns.",
    fallback_language:
      "Hotel will use rooming list and attendee data solely for the purpose of fulfilling reservations under this Agreement. Hotel will not use such data for its own marketing purposes, nor disclose it to any third party, without Group's prior written consent.",
    walk_away_condition: "",
    severity_default: "low",
    version: "v1-industry-default",
    provenance: "industry_default",
  },
];
