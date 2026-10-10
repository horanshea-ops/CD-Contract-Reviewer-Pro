import type { UnappliedReason } from "./redline-validation/types";

/**
 * What a review card says when the redline has no place for its change.
 *
 * Each sentence says what is wrong in the associate's terms. What to do about
 * it is the card's buttons, never an instruction in the sentence.
 */

export interface PlacementProblem {
  reason: UnappliedReason | null;
  /** The engine's own sentence. */
  detail: string;
  places: unknown[] | null;
}

/** Reasons the card settles with a control of its own: fields for a blank, and "Add wording". */
const SETTLED_ELSEWHERE = new Set<UnappliedReason>(["unfilled_blank", "no_wording"]);

/** True when the change has no place and the card must offer a way to give it one. */
export function needsPlacement(problem: PlacementProblem | null | undefined): problem is PlacementProblem & { reason: UnappliedReason } {
  return !!problem?.reason && !SETTLED_ELSEWHERE.has(problem.reason);
}

export function placementMessage(problem: PlacementProblem, otherChange: string | null): string {
  switch (problem.reason) {
    case "not_located":
      return "This wording isn't in the contract as quoted, so the change has no place in the Word file yet.";
    case "ambiguous_quote":
      return `This wording appears ${problem.places?.length ?? "several"} times in the contract. Pick the one this change is for.`;
    case "overlaps_another_change":
      return otherChange
        ? `This change and “${otherChange}” cover the same words. Only one of them can go into the Word file.`
        : "This change covers the same words as another one. Only one of them can go into the Word file.";
    case "in_content_control":
    case "in_field":
      return `${problem.detail} Word won't let that part of the file be changed.`;
    default:
      return `${problem.detail} So this change has no place in the Word file as it is written.`;
  }
}
