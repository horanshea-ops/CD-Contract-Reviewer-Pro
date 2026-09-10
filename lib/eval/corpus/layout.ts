import type { Block, ContractDocument } from "./docx-builder";
import type { EvalContractSpec } from "./spec";

/**
 * Assembling one eval contract from its spec and its drafted clauses
 * (MASTER_PLAN.md §2.0.1).
 *
 * Layout is deterministic. The model supplies clause prose and nothing else —
 * section order, numbering, tables, exhibits and the signature block are built
 * from the spec, so two runs of the drafter produce documents that differ only
 * in wording.
 *
 * Every value the key points at is stated exactly once in the document, in one
 * of two places. Prose states it, or a table does, never both. Duplication
 * would give a correct finding a second place to quote from that the key does
 * not know about, and that finding would score as a miss and a false positive
 * at once — the harness reporting its own gap as the model's error.
 */

/** Clause prose as the drafter returns it, before it is placed. */
export interface DraftedClause {
  clause_type: string;
  paragraphs: string[];
  /** Verbatim substrings of the joined paragraphs, one per stated field. */
  anchors: Array<{ field: string; sentence: string }>;
}

/** Where a keyed value ended up, so the key can be anchored against it. */
export interface PlacedAnchor {
  clause_type: string;
  field: string;
  /** The part it landed in — "document" or "footer1". */
  part: string;
  /** Exact text to locate. Always a full sentence or a whole table row. */
  text: string;
}

export interface LaidOutContract {
  document: ContractDocument;
  anchors: PlacedAnchor[];
}

/**
 * Contract order, as a hotel would number it. Money first, then operations,
 * then the legal tail — not the order lib/standards/v1.ts happens to list.
 */
const SECTION_ORDER: string[] = [
  "attrition",
  "cutoff_date",
  "cancellation",
  "resale_mitigation_duty",
  "force_majeure",
  "named_storm",
  "termination_rights",
  "fb_minimum",
  "gratuity_service_charge",
  "mandatory_fees",
  "rebates",
  "rate_parity",
  "master_account_billing",
  "damage_deposit",
  "walk_relocation",
  "construction_renovation",
  "brand_ownership_change",
  "labor_disputes",
  "exclusivity_vendors",
  "insurance_indemnification",
  "ada_compliance",
  "attendee_data_handling",
  "review_audit_dates",
  "assignment_subcontracting",
  "governing_law_venue",
];

const SECTION_TITLE: Record<string, string> = {
  attrition: "Attrition",
  cutoff_date: "Reservation Cutoff Date",
  cancellation: "Cancellation and Liquidated Damages",
  resale_mitigation_duty: "Resale of Released Inventory",
  force_majeure: "Force Majeure",
  named_storm: "Named Storm",
  termination_rights: "Termination for Cause",
  fb_minimum: "Food and Beverage Minimum",
  gratuity_service_charge: "Gratuity and Service Charge",
  mandatory_fees: "Mandatory Fees and Surcharges",
  rebates: "Complimentary Rooms",
  rate_parity: "Rate Parity",
  master_account_billing: "Master Account and Billing",
  damage_deposit: "Security Deposit",
  walk_relocation: "Relocation of Guaranteed Reservations",
  construction_renovation: "Construction and Renovation",
  brand_ownership_change: "Change of Brand, Management or Ownership",
  labor_disputes: "Labor Relations",
  exclusivity_vendors: "Outside Vendors",
  insurance_indemnification: "Insurance and Indemnification",
  ada_compliance: "Accessibility",
  attendee_data_handling: "Attendee Information",
  review_audit_dates: "Reporting and Audit",
  assignment_subcontracting: "Assignment",
  governing_law_venue: "Governing Law and Venue",
};

/**
 * The cancellation schedule lives in a table, not in prose.
 *
 * Real contracts put it there, and it gives the corpus a keyed value the model
 * can only reach by reading a table — the accuracy gap §1.4.5 describes. The
 * drafter is told not to state this field, so the table is its only home.
 */
const TABLE_ONLY_FIELDS = new Set(["cancellation.top_tier_pct"]);

export const isTableOnly = (clauseType: string, field: string) =>
  TABLE_ONLY_FIELDS.has(`${clauseType}.${field}`);

const pct = (n: number) => `${Math.round(n * 100)}%`;
const usd = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Bands below the top tier, scaled off it so the schedule reads as a real one. */
function cancellationRows(topTierPct: number): string[][] {
  const bands: Array<[string, number]> = [
    ["365 days or more prior to arrival", 0.25],
    ["364 through 181 days prior to arrival", 0.5],
    ["180 through 91 days prior to arrival", 0.75],
    ["90 through 31 days prior to arrival", 0.9],
  ];
  return [
    ...bands.map(([label, share]) => [label, pct(Math.min(share, topTierPct))]),
    ["30 days or fewer prior to arrival", pct(topTierPct)],
  ];
}

function roomBlockRows(spec: EvalContractSpec): string[][] {
  const perNight = Math.round(spec.room_block / spec.nights);
  return Array.from({ length: spec.nights }, (_, i) => {
    const rooms = i === spec.nights - 1 ? spec.room_block - perNight * (spec.nights - 1) : perNight;
    return [`Night ${i + 1}`, String(rooms + perNight), usd(spec.adr)];
  });
}

export function layOutContract(spec: EvalContractSpec, drafted: DraftedClause[]): LaidOutContract {
  const byClause = new Map(drafted.map((d) => [d.clause_type, d]));
  const blocks: Block[] = [];
  const anchors: PlacedAnchor[] = [];

  blocks.push({ kind: "heading", level: 1, text: "GROUP SALES AGREEMENT" });
  blocks.push({
    kind: "para",
    text:
      `This Group Sales Agreement is entered into between ${spec.hotel}, located in ${spec.city}, ${spec.state} (the "Hotel"), ` +
      `and ${spec.group} (the "Group"), for the event to be held ${spec.dates}.`,
  });

  let sectionNumber = 1;
  blocks.push({ kind: "heading", level: 1, text: `${sectionNumber}. Room Block and Rates` });
  blocks.push({
    kind: "para",
    text:
      `Hotel will hold a block of ${spec.room_block} guest rooms on the peak night at a group rate of ${usd(spec.adr)} per room, per night, ` +
      `single or double occupancy, exclusive of applicable state and local occupancy taxes. Group's contracted food and beverage minimum ` +
      `for the event is ${usd(spec.fb_minimum)}.`,
  });
  if (spec.style.tables === "many") {
    blocks.push({ kind: "table", header: ["Date", "Rooms", "Group Rate"], rows: roomBlockRows(spec) });
  }

  for (const clauseType of SECTION_ORDER) {
    if (spec.terms[clauseType] === "absent") continue;
    const clause = byClause.get(clauseType);
    if (!clause) continue;

    sectionNumber += 1;
    blocks.push({ kind: "heading", level: 1, text: `${sectionNumber}. ${SECTION_TITLE[clauseType]}` });
    for (const paragraph of clause.paragraphs) blocks.push({ kind: "para", text: paragraph });

    for (const anchor of clause.anchors) {
      anchors.push({ clause_type: clauseType, field: anchor.field, part: "document", text: anchor.sentence });
    }

    // The cancellation schedule, and the one keyed value only a table carries.
    if (clauseType === "cancellation") {
      const terms = spec.terms.cancellation;
      const topTier = terms !== "absent" && typeof terms.top_tier_pct === "number" ? terms.top_tier_pct : 1;
      const rows = cancellationRows(topTier);
      blocks.push({ kind: "table", header: ["Date of Written Cancellation Notice", "Liquidated Damages"], rows });
      anchors.push({
        clause_type: "cancellation",
        field: "top_tier_pct",
        part: "document",
        // The whole row, not the cell — a bare percentage occurs all over a
        // contract and would resolve nowhere.
        text: `${rows[rows.length - 1][0]} | ${rows[rows.length - 1][1]}`,
      });
    }
  }

  if (spec.style.exhibits) {
    blocks.push({ kind: "pageBreak" });
    blocks.push({ kind: "heading", level: 1, text: "Exhibit A — Function Space and Catering" });
    blocks.push({
      kind: "para",
      text:
        "The function space set out below is held on a tentative basis and will be confirmed upon Hotel's receipt of Group's signed agreement. " +
        "Catering selections are due no later than thirty (30) days prior to arrival.",
    });
    blocks.push({
      kind: "table",
      header: ["Function", "Space", "Estimated Attendance"],
      rows: [
        ["Opening Reception", "Grand Foyer", String(Math.round(spec.room_block * 1.2))],
        ["General Session", "Ballroom A-C", String(Math.round(spec.room_block * 1.4))],
        ["Closing Luncheon", "Ballroom A-B", String(Math.round(spec.room_block * 0.9))],
      ],
    });
  }

  blocks.push({ kind: "pageBreak" });
  blocks.push({ kind: "heading", level: 1, text: "Signatures" });
  blocks.push({
    kind: "para",
    text: "Agreed and accepted by the authorized representatives of the parties as of the dates written below.",
  });
  blocks.push({ kind: "para", text: `${spec.hotel}    By: ____________________    Title: ____________________    Date: ____________` });
  blocks.push({ kind: "para", text: `${spec.group}    By: ____________________    Title: ____________________    Date: ____________` });

  const document: ContractDocument = { title: "GROUP SALES AGREEMENT", blocks };

  if (spec.style.header_footer_terms) {
    document.header = `${spec.hotel} — Group Sales Agreement — ${spec.group} — ${spec.dates}`;

    // A binding term carried in the footer, which §1.4.1 flags as invisible to
    // the pipeline this predates. Registered as a second anchor for the clause,
    // so a finding quoting the footer is scored as pointing at the same issue.
    const cutoff = spec.terms.cutoff_date;
    if (cutoff !== "absent" && typeof cutoff.days_prior === "number") {
      const sentence = `Reservations must be received no later than ${cutoff.days_prior} days prior to arrival; the room block is released in full at that time.`;
      document.footer = sentence;
      anchors.push({ clause_type: "cutoff_date", field: "days_prior", part: "footer1", text: sentence });
    }
  }

  return { document, anchors };
}

/** Clause types this spec expects prose for, in the order they will be laid out. */
export function clausesToDraft(spec: EvalContractSpec): string[] {
  return SECTION_ORDER.filter((c) => spec.terms[c] !== "absent");
}

export { SECTION_ORDER, SECTION_TITLE };
