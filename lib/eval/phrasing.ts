/**
 * Contract number phrasing (MASTER_PLAN.md §2.0.1).
 *
 * Hotel contracts write numbers twice — "seventy percent (70%)", "thirty (30)
 * days" — and both halves matter here. The corpus builder uses `phrase` to tell
 * the drafter exactly how a term must read, so the verification gate can check
 * the value survived into the prose. The scorer uses `parseQuantities` to read
 * numbers back out of proposed language, where the model writes in whichever
 * form it likes.
 *
 * One module for both directions, so what is written and what is read can never
 * disagree about what "seventy percent (70%)" means.
 */

import type { NumericUnit } from "./types";

const ONES = [
  "zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine",
  "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen",
  "seventeen", "eighteen", "nineteen",
];

const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];

/** Words for a non-negative integer below one thousand. Contract quantities never exceed that. */
export function numberToWords(n: number): string {
  if (!Number.isInteger(n) || n < 0 || n > 999) {
    throw new Error(`numberToWords: ${n} is outside 0-999.`);
  }
  if (n < 20) return ONES[n];
  if (n < 100) {
    const tens = TENS[Math.floor(n / 10)];
    const ones = n % 10;
    return ones === 0 ? tens : `${tens}-${ONES[ones]}`;
  }
  const hundreds = `${ONES[Math.floor(n / 100)]} hundred`;
  const rest = n % 100;
  return rest === 0 ? hundreds : `${hundreds} ${numberToWords(rest)}`;
}

export function formatUsd(amount: number): string {
  return `$${amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * How a term must read in the contract.
 *
 * The drafter is given this string and told to reproduce it verbatim, which is
 * what lets the gate check by substring rather than by interpretation.
 */
export function phrase(value: number, unit: NumericUnit): string {
  switch (unit) {
    case "pct": {
      const percent = Math.round(value * 1000) / 10;
      const whole = Number.isInteger(percent) ? percent : null;
      return whole === null
        ? `${percent}%`
        : `${numberToWords(whole)} percent (${whole}%)`;
    }
    case "usd":
      return formatUsd(value);
    case "days":
      return `${numberToWords(value)} (${value}) days`;
    case "months":
      return `${numberToWords(value)} (${value}) months`;
    case "hours":
      return `${numberToWords(value)} (${value}) hours`;
    case "rooms":
      return `${numberToWords(value)} (${value})`;
  }
}

export interface Quantity {
  unit: NumericUnit;
  /** Percentages come back as fractions, so 70% reads as 0.7. */
  value: number;
  /** Where it sat in the text, for proximity to a label. */
  index: number;
}

const PERCENT_RE = /(\d+(?:\.\d+)?)\s*(?:%|percent\b)/gi;
const USD_RE = /\$\s*([\d,]+(?:\.\d{1,2})?)/g;
// The digits may be bare ("30 days") or parenthesised after the word
// ("thirty (30) days"), which is the form contracts actually use. Matching only
// the first meant every duration assertion reported "states no figure" and
// failed correct proposals — a scoring failure with no visible symptom.
const DAYS_RE = /\(?(\d+)\)?\s*(?:calendar\s+|business\s+)?days?\b/gi;
const MONTHS_RE = /\(?(\d+)\)?\s*months?\b/gi;
const HOURS_RE = /\(?(\d+)\)?\s*hours?\b/gi;

/**
 * Every quantity in a piece of text.
 *
 * Spelled-out numbers are not parsed on their own. Contract style always pairs
 * them with digits — "seventy percent (70%)" — and the digits are what this
 * reads, so "seventy percent" with no parenthetical is deliberately not a
 * match. Guessing at prose numerals would let the scorer credit a proposal
 * whose actual figure it never established.
 */
export function parseQuantities(text: string): Quantity[] {
  const out: Quantity[] = [];

  const collect = (re: RegExp, unit: NumericUnit, transform: (raw: string) => number) => {
    re.lastIndex = 0;
    for (const match of text.matchAll(re)) {
      const value = transform(match[1]);
      if (Number.isFinite(value)) out.push({ unit, value, index: match.index ?? 0 });
    }
  };

  collect(PERCENT_RE, "pct", (raw) => Number(raw) / 100);
  collect(USD_RE, "usd", (raw) => Number(raw.replace(/,/g, "")));
  collect(DAYS_RE, "days", Number);
  collect(MONTHS_RE, "months", Number);
  collect(HOURS_RE, "hours", Number);

  return out.sort((a, b) => a.index - b.index);
}
