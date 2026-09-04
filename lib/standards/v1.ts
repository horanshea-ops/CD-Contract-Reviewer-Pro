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
];
