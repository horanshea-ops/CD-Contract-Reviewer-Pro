import type { UnappliedReason } from "../redline-validation/types";

/**
 * Proposed wording that isn't ready to go in front of the property.
 *
 * The model writes a blank such as "[X]" or "[date]" where it lacks a figure.
 * It sometimes writes an instruction to the associate instead of contract
 * wording. Either would reach the hotel as written, so the redline leaves the
 * change out. The review card asks the associate for each blank's value.
 */

export interface WordingProblem {
  reason: Extract<UnappliedReason, "unfilled_blank" | "not_contract_wording">;
  detail: string;
}

const BLANK = /\[[^\]\n]{0,80}\]/g;
const BRACKET = /\[[^\]\n]*\]/g;

/** A stand-in for a value nobody has supplied yet, inside a longer bracket. */
const PLACEHOLDER = /\bX\b|_{2,}|\?{2,}/;
const PLACEHOLDERS = new RegExp(PLACEHOLDER, "g");

/** How many words of the wording to show on each side of a blank. */
const CONTEXT_WORDS = 5;

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

/** One value the wording still needs. */
export interface Blank {
  /** The bracket as written, such as "[X]" or "[date]". */
  bracket: string;
  /** The stretch of the wording a value replaces. */
  start: number;
  end: number;
}

/**
 * Every blank in the wording, in order.
 *
 * A bracket the contract already has is its own wording, not a blank. A longer
 * bracket with a placeholder inside keeps its wording, and only the
 * placeholder is filled.
 */
export function blanksIn(language: string, quote: string | null): Blank[] {
  const quoted = quote ?? "";
  const blanks: Blank[] = [];

  for (const match of language.matchAll(BLANK)) {
    const bracket = match[0];
    if (quoted.includes(bracket) || contractsOwn(bracket, quoted)) continue;

    const inner = bracket.slice(1, -1);
    const holes = [...inner.matchAll(PLACEHOLDERS)];
    if (holes.length > 0 && holes[0][0].length < inner.trim().length) {
      for (const hole of holes) {
        const start = match.index + 1 + hole.index;
        blanks.push({ bracket, start, end: start + hole[0].length });
      }
    } else {
      blanks.push({ bracket, start: match.index, end: match.index + bracket.length });
    }
  }
  return blanks;
}

/**
 * The wording with a value in place of each blank, in order. Null when a value
 * is missing or empty, so a half-filled wording is never saved.
 */
export function fillBlanks(language: string, quote: string | null, values: string[]): string | null {
  const blanks = blanksIn(language, quote);
  const typed = values.map((v) => v.trim());
  if (typed.length !== blanks.length || typed.some((v) => !v)) return null;

  // Last first, so each earlier position still holds.
  let filled = language;
  for (let i = blanks.length - 1; i >= 0; i--) {
    filled = filled.slice(0, blanks[i].start) + typed[i] + filled.slice(blanks[i].end);
  }
  return filled;
}

/** A few words either side of a blank, so two written the same can be told apart. */
export function blankContext(language: string, blank: Blank): { before: string; after: string } {
  const head = language.slice(0, blank.start);
  const tail = language.slice(blank.end);
  const before = head.match(new RegExp(`(?:\\S+\\s*){0,${CONTEXT_WORDS}}$`))?.[0] ?? "";
  const after = tail.match(new RegExp(`^(?:\\s*\\S+){0,${CONTEXT_WORDS}}`))?.[0] ?? "";

  return {
    before: before.length < head.trimStart().length ? `… ${before}` : before,
    after: after.length < tail.trimEnd().length ? `${after} …` : after,
  };
}

export function wordingProblem(language: string, quote: string | null): WordingProblem | null {
  const [blank] = blanksIn(language, quote);
  if (blank) {
    return { reason: "unfilled_blank", detail: `The proposed wording still has a blank to fill in: ${blank.bracket}.` };
  }
  if (INSTRUCTION.test(language)) {
    return {
      reason: "not_contract_wording",
      detail: "The proposed wording reads as an instruction to the reviewer, not contract wording.",
    };
  }
  return null;
}
