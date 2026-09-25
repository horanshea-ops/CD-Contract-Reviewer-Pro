/**
 * Exposure figures the app works out itself.
 *
 * The model writes the arithmetic behind a figure, and this module evaluates
 * it. A model asked for the figure alone got its own sums wrong, and the wrong
 * figure reached the finding card, the review total and the client email. So
 * the amount shown is always the formula's result, and a figure with no formula
 * that evaluates is not shown at all.
 *
 * The parser accepts numbers, + - * / ( ), ×, ÷, % and a leading $. It never
 * calls eval, and anything else makes the formula unreadable.
 */

type Token = { kind: "number"; value: number; text: string } | { kind: "op"; op: string };

const OPERATORS: Record<string, string> = { "+": "+", "-": "-", "−": "-", "*": "*", "×": "*", "/": "/", "÷": "/", "(": "(", ")": ")" };

function tokenize(formula: string): Token[] | null {
  const tokens: Token[] = [];
  let i = 0;
  while (i < formula.length) {
    const c = formula[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (OPERATORS[c]) {
      tokens.push({ kind: "op", op: OPERATORS[c] });
      i++;
      continue;
    }
    const m = formula.slice(i).match(/^\$?(\d{1,3}(?:,\d{3})+|\d+)(\.\d+)?%?|^\$?\.\d+%?/);
    if (!m) return null;
    const text = m[0];
    const digits = text.replace(/[$,%]/g, "");
    const value = Number(digits) / (text.endsWith("%") ? 100 : 1);
    if (!Number.isFinite(value)) return null;
    tokens.push({ kind: "number", value, text });
    i += text.length;
  }
  return tokens;
}

/** Evaluates an arithmetic formula, or returns null if it holds anything else. */
export function evaluateFormula(formula: string): number | null {
  const parsed = tokenize(formula);
  if (!parsed || parsed.length === 0) return null;
  const tokens: Token[] = parsed;
  let at = 0;

  const peek = () => tokens[at];
  const isOp = (op: string) => peek()?.kind === "op" && (peek() as { op: string }).op === op;

  function primary(): number | null {
    const t = peek();
    if (!t) return null;
    if (t.kind === "number") {
      at++;
      return t.value;
    }
    if (t.op === "-") {
      at++;
      const v = primary();
      return v === null ? null : -v;
    }
    if (t.op === "(") {
      at++;
      const v = sum();
      if (v === null || !isOp(")")) return null;
      at++;
      return v;
    }
    return null;
  }

  function product(): number | null {
    let v = primary();
    while (v !== null && (isOp("*") || isOp("/"))) {
      const op = (tokens[at++] as { op: string }).op;
      const rhs = primary();
      if (rhs === null || (op === "/" && rhs === 0)) return null;
      v = op === "*" ? v * rhs : v / rhs;
    }
    return v;
  }

  function sum(): number | null {
    let v = product();
    while (v !== null && (isOp("+") || isOp("-"))) {
      const op = (tokens[at++] as { op: string }).op;
      const rhs = product();
      if (rhs === null) return null;
      v = op === "+" ? v + rhs : v - rhs;
    }
    return v;
  }

  const result = sum();
  return result !== null && at === tokens.length && Number.isFinite(result) ? result : null;
}

const roundCents = (n: number) => Math.round(n * 100) / 100;

export interface CheckedExposure {
  exposure_amount: number | null;
  exposure_formula: string | null;
  /** The model's own figure, when it differs from the formula's result. */
  model_amount_disagreed: number | null;
}

/** The amount a finding may show: its formula's result, or none. */
export function checkExposure(finding: { exposure_amount: number | null; exposure_formula?: string | null }): CheckedExposure {
  const formula = finding.exposure_formula?.trim() || null;
  const result = formula ? evaluateFormula(formula) : null;
  const amount = result === null ? null : roundCents(result);
  const disagreed =
    finding.exposure_amount != null && (amount === null || Math.abs(finding.exposure_amount - amount) >= 1)
      ? finding.exposure_amount
      : null;
  return { exposure_amount: amount, exposure_formula: amount === null ? null : formula, model_amount_disagreed: disagreed };
}

/**
 * A formula written for a reader: "2280 * 149 * 0.10" becomes
 * "2,280 × 149 × 10% = $33,972". Numbers get commas, a decimal under one reads
 * as a percent, and the result is in whole dollars.
 */
export function formatCalculation(formula: string, amount: number): string {
  const tokens = tokenize(formula) ?? [];
  const parts = tokens.map((t) => {
    if (t.kind === "op") return { "*": "×", "/": "÷", "-": "−", "+": "+", "(": "(", ")": ")" }[t.op] ?? t.op;
    const dollar = t.text.startsWith("$") ? "$" : "";
    if (t.text.endsWith("%") || (t.value > 0 && t.value < 1)) {
      return `${Number((t.value * 100).toFixed(4))}%`;
    }
    return `${dollar}${t.value.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
  });
  const spaced = parts.join(" ").replace(/\( /g, "(").replace(/ \)/g, ")");
  return `${spaced} = $${Math.round(amount).toLocaleString("en-US")}`;
}
