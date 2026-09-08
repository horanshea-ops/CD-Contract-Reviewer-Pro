/**
 * Character normalisation for model-facing text (MASTER_PLAN.md §1.4.6).
 *
 * §1.5 must reuse this function verbatim. If extraction and span-location
 * normalise differently, the phrase the model quoted will not be found in the
 * text it was quoted from, and findings will silently fail to apply.
 *
 * It is deliberately per-character. A whole-string pass looks equivalent but is
 * not: removing a soft hyphen shifts every offset after it, so a map built
 * before the pass no longer lines up with the text after it. Emitting character
 * by character keeps text and map in lockstep by construction.
 */

/** Substitutions that preserve length one-for-one. */
const ONE_TO_ONE: Record<string, string> = {
  // Curly quotes and primes. Hotels paste from Word, so these are everywhere,
  // and a quote containing one will never match a straight-quoted copy.
  "‘": "'", // left single
  "’": "'", // right single / apostrophe
  "‚": "'", // single low-9
  "‛": "'", // single high-reversed-9
  "′": "'", // prime
  "“": '"', // left double
  "”": '"', // right double
  "„": '"', // double low-9
  "″": '"', // double prime
  // Dashes and hyphens. A non-breaking hyphen reads identically and compares
  // unequal, which is exactly the sort of difference that defeats matching.
  "‑": "-", // non-breaking hyphen
  "‐": "-", // hyphen
  "‒": "-", // figure dash
  "−": "-", // minus sign
  // Spaces. Non-breaking space is common before "%" and in "$ 35.00".
  " ": " ", // no-break space
  " ": " ", // figure space
  " ": " ", // narrow no-break space
  " ": " ", // thin space
  " ": " ", // hair space
  "　": " ", // ideographic space
};

/** Characters removed entirely — they are invisible to a reader. */
const REMOVED = new Set([
  "­", // soft hyphen
  "​", // zero-width space
  "‌", // zero-width non-joiner
  "‍", // zero-width joiner
  "﻿", // zero-width no-break space / BOM
]);

/**
 * Normalise a single character.
 *
 * Returns the replacement, which may be the character unchanged, or "" when the
 * character is dropped. Never returns more than one character, so callers can
 * assume output length is 0 or 1.
 */
export function normalizeChar(ch: string): string {
  if (REMOVED.has(ch)) return "";
  const mapped = ONE_TO_ONE[ch];
  if (mapped !== undefined) return mapped;
  return ch;
}

/**
 * Normalise a whole string. Use for comparing text that has no map attached —
 * matching a model-supplied quote, for instance. Do NOT use while building a
 * source map; emit character by character with normalizeChar instead.
 */
export function normalizeText(s: string): string {
  let out = "";
  for (const ch of s) out += normalizeChar(ch);
  return out;
}

/**
 * Collapse runs of whitespace to single spaces, for comparisons that should
 * tolerate line-break and indentation differences. Separate from normalizeText
 * because it changes length unpredictably and so must never touch mapped text.
 */
export function collapseWhitespace(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}
