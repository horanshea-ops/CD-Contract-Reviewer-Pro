import type { UnappliedReason } from "../redline-validation/types";

/**
 * Proposed wording that isn't ready to go in front of the property.
 *
 * CD's own standard wording leaves blanks such as "[X]" or "[date]" for the
 * associate to fill, and the model copies them. It sometimes writes an
 * instruction to the associate instead of contract wording. Either would reach
 * the hotel as written, so the redline leaves the change out and says why.
 */

export interface WordingProblem {
  reason: Extract<UnappliedReason, "unfilled_blank" | "not_contract_wording">;
  detail: string;
}

const BLANK = /\[[^\]\n]{0,80}\]/g;

// A verb that opens an instruction, followed by the word an instruction takes
// next. The second word keeps contract wording such as "State and local taxes"
// from matching.
const INSTRUCTION =
  /^\s*["'“‘]?(state|confirm|specify|clarify|request|negotiate|ask|ensure|consider|propose|insert|replace|strike|revise|amend|change)\s+(the|that|whether|a|an|this|these|any|explicitly|clearly|in|with|to|for|how|what|which)\b/i;

export function wordingProblem(language: string, quote: string | null): WordingProblem | null {
  // A bracket the contract already has is its own wording, not a blank.
  const blank = (language.match(BLANK) ?? []).find((b) => !(quote ?? "").includes(b));
  if (blank) {
    return { reason: "unfilled_blank", detail: `The proposed wording still has a blank to fill in: ${blank}.` };
  }
  if (INSTRUCTION.test(language)) {
    return {
      reason: "not_contract_wording",
      detail: "The proposed wording reads as an instruction to the reviewer, not contract wording.",
    };
  }
  return null;
}
