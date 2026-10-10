/**
 * A proposed amount that no longer follows from the formula beside it.
 *
 * A cancellation or F&B tier often states an amount with its formula, such as
 * "$80,000.00 [determined by multiplying the F&B Minimum times 80%]". The
 * model changes one and forgets the other: the percentage becomes 35% and the
 * amount stays $80,000.
 *
 * The contract's own pair gives the base it is using (amount ÷ percentages).
 * A proposed pair that implies a different base is flagged, with the amount
 * the contract's base gives.
 *
 * The check is certain where it speaks, so it speaks only when the wording's
 * shape is unambiguous: the same number of pairs before and after, and each
 * formula unchanged apart from its percentages. Otherwise it says nothing.
 * A flagged amount can still be right, when the contract's own arithmetic is
 * off or the amount rests on another change, so this warns and blocks nothing.
 */

interface Pair {
  /** Where the amount sits in the wording, symbol included. */
  start: number;
  /** The amount as written, such as "$80,000.00". */
  written: string;
  symbol: string;
  amount: number;
  /** Digits after the point, as written. */
  decimals: number;
  /** The smallest step the amount is written to: a cent, or a whole unit. */
  step: number;
  percentages: number[];
  /** The formula with its percentages taken out, for telling two formulas apart. */
  formula: string;
}

const PAIR = /(([$€£])\s?(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?))\s*\[([^\]\n]*)\]/g;
const PERCENTAGE = /(\d+(?:\.\d+)?)\s*%/g;
const PERCENTAGE_FACTOR = /,?\s*(?:\b(?:times|multiplied by|x)\b|×)?\s*\d+(?:\.\d+)?\s*%/gi;

function pairsIn(text: string): Pair[] {
  return [...text.matchAll(PAIR)].flatMap((match) => {
    const [, written, symbol, figure, bracket] = match;
    const percentages = [...bracket.matchAll(PERCENTAGE)].map((m) => Number(m[1]));
    if (percentages.length === 0 || percentages.includes(0)) return [];

    const decimals = figure.split(".")[1]?.length ?? 0;
    return [
      {
        start: match.index,
        written,
        symbol,
        amount: Number(figure.replace(/,/g, "")),
        decimals,
        step: 10 ** -decimals,
        percentages,
        formula: bracket.replace(PERCENTAGE_FACTOR, "").replace(/[\s,.]+/g, " ").trim().toLowerCase(),
      },
    ];
  });
}

const product = (percentages: number[]) => percentages.reduce((total, p) => total * (p / 100), 1);

const money = (symbol: string, amount: number) =>
  `${symbol}${amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** One proposed amount that doesn't follow from the contract's own base. */
export interface FigureProblem {
  /** The stretch of the wording the amount takes up. */
  start: number;
  end: number;
  /** The amount as the wording has it. */
  written: string;
  /** The amount the contract's base gives, written the same way. */
  worked: string;
  /** The arithmetic, for the card. */
  detail: string;
}

/**
 * Every proposed amount that doesn't follow from the contract's own base, in
 * order. Empty when every amount does, or when none can be checked.
 */
export function figureProblems(quote: string | null, language: string): FigureProblem[] {
  if (!quote) return [];

  const before = pairsIn(quote);
  const after = pairsIn(language);
  if (before.length === 0 || before.length !== after.length) return [];
  if (before.some((pair, i) => pair.formula !== after[i].formula)) return [];

  return before.flatMap((old, i) => {
    const proposed = after[i];
    const base = old.amount / product(old.percentages);
    const expected = base * product(proposed.percentages);

    // Each written amount is rounded to its own step, and the old one's rounding is scaled with the base.
    const slack = (old.step / 2) * (product(proposed.percentages) / product(old.percentages)) + proposed.step / 2 + 0.005;
    if (Math.abs(proposed.amount - expected) <= slack) return [];

    const rate = proposed.percentages.map((p) => `${p}%`).join(" × ");
    const figure = expected.toLocaleString("en-US", {
      minimumFractionDigits: proposed.decimals,
      maximumFractionDigits: proposed.decimals,
    });
    return [
      {
        start: proposed.start,
        end: proposed.start + proposed.written.length,
        written: proposed.written,
        // The symbol and any space after it are kept as the wording has them.
        worked: proposed.written.replace(/\d[\d,.]*$/, figure),
        detail:
          `At ${rate} of the contract's ${money(old.symbol, base)} base it would be ${money(proposed.symbol, expected)}. ` +
          `The wording says ${money(proposed.symbol, proposed.amount)}.`,
      },
    ];
  });
}

/** The wording with each flagged amount replaced by the one the contract's base gives. */
export function withWorkedAmounts(language: string, problems: FigureProblem[]): string {
  // Last first, so each earlier position still holds.
  return [...problems]
    .sort((a, b) => b.start - a.start)
    .reduce((wording, p) => wording.slice(0, p.start) + p.worked + wording.slice(p.end), language);
}

/**
 * One line for the card when a proposed amount doesn't follow from the
 * contract's own base, or null when every amount does or none can be checked.
 */
export function figureCheck(quote: string | null, language: string): string | null {
  const problems = figureProblems(quote, language);
  if (problems.length === 0) return null;
  return `${problems.length === 1 ? "Check this amount." : "Check these amounts."} ${problems.map((p) => p.detail).join(" ")}`;
}
