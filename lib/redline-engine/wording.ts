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
const BRACKET = /\[[^\]\n]*\]/g;

/** A stand-in for a value nobody has supplied yet, inside a longer bracket. */
const PLACEHOLDER = /\bX\b|_{2,}|\?{2,}/;

/** Words that open a bracket before it counts as the same one the quote has. */
const SAME_OPENING_WORDS = 3;

const wordsIn = (bracket: string) => bracket.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
const withoutFigures = (bracket: string) => bracket.replace(/\d[\d,.]*/g, "#").replace(/\s+/g, " ");

/**
 * True when a bracket is the contract's own with something changed inside it,
 * such as "[determined by multiplying the minimum times 80%]" with a new
 * percentage. The quote must hold a bracket that opens with the same words,
 * or reads the same once its figures are set aside. A short bracket such as
 * "[X]" or "[date]" never passes here, so it must be in the quote as written.
 */
function contractsOwn(bracket: string, quote: string): boolean {
  if (PLACEHOLDER.test(bracket)) return false;
  const opening = wordsIn(bracket).slice(0, SAME_OPENING_WORDS).join(" ");
  const bare = withoutFigures(bracket);

  return (quote.match(BRACKET) ?? []).some((theirs) => {
    if (/\d/.test(bracket) && withoutFigures(theirs) === bare) return true;
    return wordsIn(bracket).length >= SAME_OPENING_WORDS && wordsIn(theirs).slice(0, SAME_OPENING_WORDS).join(" ") === opening;
  });
}

// A verb that opens an instruction, followed by the word an instruction takes
// next. The second word keeps contract wording such as "State and local taxes"
// from matching.
const INSTRUCTION =
  /^\s*["'“‘]?(state|confirm|specify|clarify|request|negotiate|ask|ensure|consider|propose|insert|replace|strike|revise|amend|change|reconcile|align|harmonize|conform|verify)\s+(the|that|whether|a|an|this|these|any|explicitly|clearly|in|with|to|for|how|what|which)\b/i;

export function wordingProblem(language: string, quote: string | null): WordingProblem | null {
  // A bracket the contract already has is its own wording, not a blank.
  const quoted = quote ?? "";
  const blank = (language.match(BLANK) ?? []).find((b) => !quoted.includes(b) && !contractsOwn(b, quoted));
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
