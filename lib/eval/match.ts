import { locateQuote } from "../redline-engine/locate";
import { isLocated } from "../redline-engine/types";
import type { LocatablePart } from "../redline-engine/locate";
import type { Finding } from "../anthropic";
import { maxWeightAssignment } from "./hungarian";
import type { AnchorSpan, KeyItem, LocationStatus, MatchBasis } from "./types";

/**
 * Pairing model findings with answer-key items (MASTER_PLAN.md §2.0.1).
 *
 * This is the part of the harness a bug hides in. A mis-paired finding does not
 * throw and does not look wrong — it lowers one rate and raises another, and
 * the report reads exactly as it would if the model had made that mistake.
 * Nothing downstream would ever contradict it.
 *
 * Two rules keep it honest.
 *
 * **Identity is decided by location, never by a graded field.** If findings were
 * paired by clause type, then "right issue, wrong clause type" could not exist
 * as an outcome — it would silently become a miss plus a false positive, and
 * clause-type accuracy would read as perfect on exactly the findings that got it
 * wrong. So a finding is placed in the document first, and only then are its
 * attributes graded.
 *
 * **The pairing is optimal, not greedy.** One finding is often the best
 * candidate for two key items; taking the wrong one costs a second pair a
 * different arrangement would have kept. See ./hungarian.
 *
 * Location comes from lib/redline-engine/locate.ts, the same function §1.5 uses
 * to decide where a redline goes. Writing a second matcher here would let the
 * harness call a finding locatable that the redline engine cannot locate, and
 * that disagreement is itself worth catching.
 */

// Tiers, spaced so no combination of lower terms can reach the tier above.
const SPAN_BASE = 1_000_000;
const CLAUSE_REGION_BASE = 500_000;
const CLAUSE_TYPE_BASE = 100_000;
const OVERLAP_SCALE = 10_000;
const CLAUSE_TYPE_AGREES = 300;
const PRESENCE_AGREES = 200;
const SEVERITY_AGREES = 100;

/**
 * Clause-type names the model uses for a library clause type.
 *
 * `Finding.clause_type` is free text — the tool schema does not constrain it —
 * so the model names a clause in whatever words it likes. Aliases are listed
 * explicitly rather than guessed at by string similarity, because a similarity
 * threshold pairs findings the harness cannot justify and reports the result as
 * fact. Anything unlisted simply does not match, and the report prints every
 * unmatched finding with the clause type it used, so this table grows from
 * observed output rather than from imagination.
 */
const CLAUSE_TYPE_ALIASES: Record<string, string> = {
  room_attrition: "attrition",
  attrition_damages: "attrition",
  cancellation_damages: "cancellation",
  liquidated_damages: "cancellation",
  cancellation_schedule: "cancellation",
  food_and_beverage_minimum: "fb_minimum",
  f_b_minimum: "fb_minimum",
  food_beverage_minimum: "fb_minimum",
  cut_off_date: "cutoff_date",
  cutoff: "cutoff_date",
  reservation_cutoff: "cutoff_date",
  walk: "walk_relocation",
  relocation: "walk_relocation",
  walked_guests: "walk_relocation",
  resort_fees: "mandatory_fees",
  mandatory_fees_and_surcharges: "mandatory_fees",
  surcharges: "mandatory_fees",
  comp_rooms: "rebates",
  complimentary_rooms: "rebates",
  renovation: "construction_renovation",
  construction: "construction_renovation",
  billing: "master_account_billing",
  master_account: "master_account_billing",
  reporting_and_audit: "review_audit_dates",
  audit_rights: "review_audit_dates",
  indemnification: "insurance_indemnification",
  insurance: "insurance_indemnification",
  security_deposit: "damage_deposit",
  outside_vendors: "exclusivity_vendors",
  vendor_exclusivity: "exclusivity_vendors",
  termination: "termination_rights",
  assignment: "assignment_subcontracting",
  ownership_change: "brand_ownership_change",
  change_of_ownership: "brand_ownership_change",
  hurricane: "named_storm",
  attendee_data: "attendee_data_handling",
  data_privacy: "attendee_data_handling",
  ada: "ada_compliance",
  accessibility: "ada_compliance",
  governing_law: "governing_law_venue",
  venue: "governing_law_venue",
  labor: "labor_disputes",
  labor_relations: "labor_disputes",
  service_charge: "gratuity_service_charge",
  gratuity: "gratuity_service_charge",
  resale: "resale_mitigation_duty",
  mitigation: "resale_mitigation_duty",
  resale_credit: "resale_mitigation_duty",
};

/** Strips the decoration models add around a clause name, without guessing at meaning. */
export function normalizeClauseType(raw: string): string {
  const base = raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/^(the|a)_/, "")
    .replace(/_(clause|clauses|provision|provisions|terms|term|section)$/, "")
    .replace(/^(clause|provision|section)_/, "");
  return CLAUSE_TYPE_ALIASES[base] ?? base;
}

export const clauseTypesAgree = (a: string, b: string) => normalizeClauseType(a) === normalizeClauseType(b);

/** Where a finding points, decided the way the redline engine decides it. */
export function locateFinding(parts: LocatablePart[], finding: Finding): LocationStatus {
  const quote = (finding.quoted_text ?? "").trim();
  if (!quote) return { status: "no_quote" };

  const result = locateQuote(parts, quote, finding.location_section);
  if (isLocated(result)) {
    return {
      status: "located",
      span: { part: result.part, start: result.start, end: result.end },
      resolution: result.resolution,
    };
  }
  return result.ambiguous
    ? { status: "ambiguous", reason: result.reason }
    : { status: "unlocatable", reason: result.reason };
}

const overlapLength = (a: AnchorSpan, b: AnchorSpan) =>
  a.part !== b.part ? 0 : Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start));

/** How much of the key's best-covered anchor this span covers, from 0 to 1. */
export function bestOverlap(anchors: AnchorSpan[], span: AnchorSpan): number {
  let best = 0;
  for (const anchor of anchors) {
    const length = anchor.end - anchor.start;
    if (length <= 0) continue;
    best = Math.max(best, overlapLength(anchor, span) / length);
  }
  return best;
}

/**
 * The stretch of each part a clause's anchors span, end to end.
 *
 * A clause is bigger than the sentences that state its terms. The drafted
 * clause has an opening, procedural wording between the terms, and a tail, and
 * none of that is anchored. A finding quoting one of those sentences is about
 * the clause all the same — but it overlaps no anchor, so on anchor evidence
 * alone it looks like a finding about somewhere else entirely, and would be
 * scored as a miss and a false positive at once.
 *
 * Computed per part, because a clause restated in the footer has anchors in two
 * parts and a hull spanning them would cover text belonging to neither.
 */
export function clauseRegions(anchors: AnchorSpan[]): AnchorSpan[] {
  const byPart = new Map<string, AnchorSpan>();
  for (const anchor of anchors) {
    const existing = byPart.get(anchor.part);
    byPart.set(
      anchor.part,
      existing
        ? { part: anchor.part, start: Math.min(existing.start, anchor.start), end: Math.max(existing.end, anchor.end) }
        : { ...anchor }
    );
  }
  return [...byPart.values()];
}

/** Whether a span falls inside the stretch a clause's anchors cover. */
export function withinClauseRegion(anchors: AnchorSpan[], span: AnchorSpan): boolean {
  return clauseRegions(anchors).some((region) => overlapLength(region, span) > 0);
}

export interface Candidate {
  basis: MatchBasis;
  weight: number;
  overlap: number;
}

/**
 * Whether a finding and a key item are about the same thing, and how strongly.
 *
 * Location evidence is authoritative wherever both sides have it: two things
 * that name places in the document and do not overlap are about different text,
 * and a shared clause type does not change that.
 *
 * Clause type is the fallback, used only where location evidence is genuinely
 * missing — a missing-clause key item has nowhere to point, a missing-clause
 * finding quotes nothing, and a quote appearing in several places resolves
 * nowhere. Allowing the fallback across kinds is deliberate: a model that calls
 * a present-but-adverse clause "missing" has found the issue and mislabelled
 * it, and that has to grade as a presence error on a real pair rather than
 * vanish into a miss and a false positive at once.
 */
export function scoreCandidate(item: KeyItem, finding: Finding, location: LocationStatus): Candidate | null {
  const typesAgree = clauseTypesAgree(item.clause_type, finding.clause_type);
  const presenceAgrees = (item.kind === "absent") === Boolean(finding.is_missing_clause);
  const severityAgrees = item.severity === finding.severity;

  const attributes =
    (typesAgree ? CLAUSE_TYPE_AGREES : 0) +
    (presenceAgrees ? PRESENCE_AGREES : 0) +
    (severityAgrees ? SEVERITY_AGREES : 0);

  const bothLocated = location.status === "located" && item.kind === "present" && item.anchors.length > 0;

  if (bothLocated) {
    const overlap = bestOverlap(item.anchors, location.span);
    if (overlap > 0) {
      return { basis: "span", weight: SPAN_BASE + Math.round(overlap * OVERLAP_SCALE) + attributes, overlap };
    }
    // Inside the clause but not on a term sentence. Weaker than an anchor hit,
    // so an anchor hit always wins the pairing, but not nothing — the finding is
    // still pointing at this clause and no other.
    if (withinClauseRegion(item.anchors, location.span)) {
      return { basis: "span", weight: CLAUSE_REGION_BASE + attributes, overlap: 0 };
    }
    return null;
  }

  if (!typesAgree) return null;
  return { basis: "clause_type", weight: CLAUSE_TYPE_BASE + attributes, overlap: 0 };
}

export interface Pairing {
  keyIndex: number;
  findingIndex: number;
  basis: MatchBasis;
  weight: number;
  overlap: number;
}

export interface MatchResult {
  pairs: Pairing[];
  locations: LocationStatus[];
  /** Key items nothing was paired with, with the finding that swallowed them where there is one. */
  unmatchedKey: Array<{ keyIndex: number; conflatedWith: number | null }>;
  /** Findings nothing was paired with, with the key item they duplicate where there is one. */
  unmatchedFindings: Array<{ findingIndex: number; duplicateOf: number | null }>;
}

/** A finding's identity independent of where it sits in the array. */
const findingKey = (f: Finding) =>
  `${normalizeClauseType(f.clause_type)} ${f.quoted_text ?? ""} ${f.finding_text} ${f.proposed_language}`;

/**
 * Pairs one document's findings against its key items.
 *
 * Both sides are put into a canonical order before the matrix is built — key
 * items by id, findings by their content — so the answer does not depend on the
 * order they arrived in. The optimiser breaks ties by column, which is
 * deterministic for a given matrix but not for a permuted one, and an accuracy
 * number that changes when a list is reordered is not a measurement.
 */
export function matchDocument(keyItems: KeyItem[], findings: Finding[], parts: LocatablePart[]): MatchResult {
  const locations = findings.map((finding) => locateFinding(parts, finding));

  const keyOrder = keyItems.map((_, i) => i).sort((a, b) => keyItems[a].id.localeCompare(keyItems[b].id));
  const findingOrder = findings
    .map((_, i) => i)
    .sort((a, b) => findingKey(findings[a]).localeCompare(findingKey(findings[b])) || a - b);

  const candidates = keyOrder.map((k) =>
    findingOrder.map((f) => scoreCandidate(keyItems[k], findings[f], locations[f]))
  );
  const weights = candidates.map((row) => row.map((c) => c?.weight ?? 0));

  const assignment = maxWeightAssignment(weights);

  const pairs: Pairing[] = [];
  const keyPaired = new Set<number>();
  const findingPaired = new Set<number>();

  for (const [row, column] of assignment.rowsToCols.entries()) {
    if (column === -1) continue;
    const keyIndex = keyOrder[row];
    const findingIndex = findingOrder[column];
    const candidate = candidates[row][column]!;
    pairs.push({ keyIndex, findingIndex, basis: candidate.basis, weight: candidate.weight, overlap: candidate.overlap });
    keyPaired.add(keyIndex);
    findingPaired.add(findingIndex);
  }
  pairs.sort((a, b) => a.keyIndex - b.keyIndex);

  // A key item whose wording a matched finding already covers was not missed in
  // the ordinary sense — one finding stood in for two issues, and it carries one
  // severity and one replacement where two were needed. Reported apart from a
  // clause nobody looked at, because the fix is different.
  const unmatchedKey = keyItems
    .map((item, keyIndex) => ({ item, keyIndex }))
    .filter(({ keyIndex }) => !keyPaired.has(keyIndex))
    .map(({ item, keyIndex }) => {
      const swallower = pairs.find((pair) => {
        const location = locations[pair.findingIndex];
        return location.status === "located" && bestOverlap(item.anchors, location.span) >= 0.5;
      });
      return { keyIndex, conflatedWith: swallower ? swallower.findingIndex : null };
    });

  // A finding pointing at a key item another finding already took is the same
  // issue reported twice, not an invented one.
  //
  // Eligibility is asked of scoreCandidate rather than re-derived here. Two
  // rules for the same question drift: the first version of this used its own
  // overlap test, and a finding sitting in a clause's unanchored middle came
  // back spurious even though the matcher considered it a candidate for that
  // very clause.
  const unmatchedFindings = findings
    .map((finding, findingIndex) => ({ finding, findingIndex }))
    .filter(({ findingIndex }) => !findingPaired.has(findingIndex))
    .map(({ finding, findingIndex }) => {
      const location = locations[findingIndex];
      const duplicated = pairs.find(
        (pair) => scoreCandidate(keyItems[pair.keyIndex], finding, location) !== null
      );
      return { findingIndex, duplicateOf: duplicated ? duplicated.keyIndex : null };
    });

  return { pairs, locations, unmatchedKey, unmatchedFindings };
}
