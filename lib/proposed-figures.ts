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
  symbol: string;
  amount: number;
  /** The smallest step the amount is written to: a cent, or a whole unit. */
  step: number;
  percentages: number[];
  /** The formula with its percentages taken out, for telling two formulas apart. */
  formula: string;
}

const PAIR = /([$€£])\s?(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)\s*\[([^\]\n]*)\]/g;
const PERCENTAGE = /(\d+(?:\.\d+)?)\s*%/g;
const PERCENTAGE_FACTOR = /,?\s*(?:\b(?:times|multiplied by|x)\b|×)?\s*\d+(?:\.\d+)?\s*%/gi;

function pairsIn(text: string): Pair[] {
  return [...text.matchAll(PAIR)].flatMap(([, symbol, figure, bracket]) => {
    const percentages = [...bracket.matchAll(PERCENTAGE)].map((m) => Number(m[1]));
    if (percentages.length === 0 || percentages.includes(0)) return [];

    const decimals = figure.split(".")[1]?.length ?? 0;
    return [
      {
        symbol,
        amount: Number(figure.replace(/,/g, "")),
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

/**
 * One line for the card when a proposed amount doesn't follow from the
 * contract's own base, or null when every amount does or none can be checked.
 */
export function figureCheck(quote: string | null, language: string): string | null {
  if (!quote) return null;

  const before = pairsIn(quote);
  const after = pairsIn(language);
  if (before.length === 0 || before.length !== after.length) return null;
  if (before.some((pair, i) => pair.formula !== after[i].formula)) return null;

  const problems = before.flatMap((old, i) => {
    const proposed = after[i];
    const base = old.amount / product(old.percentages);
    const expected = base * product(proposed.percentages);

    // Each written amount is rounded to its own step, and the old one's rounding is scaled with the base.
    const slack = (old.step / 2) * (product(proposed.percentages) / product(old.percentages)) + proposed.step / 2 + 0.005;
    if (Math.abs(proposed.amount - expected) <= slack) return [];

    const rate = proposed.percentages.map((p) => `${p}%`).join(" × ");
    return [
      `At ${rate} of the contract's ${money(old.symbol, base)} base it would be ${money(proposed.symbol, expected)}. ` +
        `The wording says ${money(proposed.symbol, proposed.amount)}.`,
    ];
  });

  if (problems.length === 0) return null;
  return `${problems.length === 1 ? "Check this amount." : "Check these amounts."} ${problems.join(" ")}`;
}
