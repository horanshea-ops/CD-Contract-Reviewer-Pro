import { currencyOf } from "./exposure";
import type { Category } from "./standards/types";

/**
 * A review's whole-list stats — category counts, decision counts, total
 * exposure — for the overview bar above the findings list (ROADMAP item 7).
 *
 * Takes a narrow structural type rather than importing `Finding` from the
 * review screen, so this stays a plain lib module other code can import
 * without a lib-depends-on-app edge.
 */

export type FindingSeverity = "high" | "medium" | "low" | "note";

export const SEVERITY_ORDER: Record<FindingSeverity, number> = { high: 0, medium: 1, low: 2, note: 3 };

const CATEGORY_ORDER: Record<Category, number> = { business: 0, legal: 1, other: 2 };

/** A finding's category. Rows from before categories fall back on severity, where "note" meant Other. */
export function findingCategory(f: { category?: Category | null; severity: FindingSeverity }): Category {
  return f.category ?? (f.severity === "note" ? "other" : "business");
}

/** The review's reading order: business, then legal, then other, each by severity. */
export function compareFindings(
  a: { category?: Category | null; severity: FindingSeverity },
  b: { category?: Category | null; severity: FindingSeverity }
): number {
  return (
    CATEGORY_ORDER[findingCategory(a)] - CATEGORY_ORDER[findingCategory(b)] ||
    SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]
  );
}

interface FindingLike {
  severity: FindingSeverity;
  category?: Category | null;
  exposure_amount: number | null;
  exposure_formula?: string | null;
  current_action: { action: "accept" | "edit" | "dismiss" } | null;
}

export interface FindingsOverview {
  total: number;
  byCategory: Record<Category, number>;
  undecidedCount: number;
  includedCount: number;
  dismissedCount: number;
  totalExposure: number;
  /** The symbol the exposures are written in; one contract uses one currency. */
  exposureCurrency: string;
  /** True when any finding carries a figure, dismissed or not. */
  hasExposure: boolean;
}

export function computeFindingsOverview(findings: FindingLike[]): FindingsOverview {
  const byCategory: Record<Category, number> = { business: 0, legal: 0, other: 0 };
  let undecidedCount = 0;
  let includedCount = 0;
  let dismissedCount = 0;
  let totalExposure = 0;

  for (const f of findings) {
    byCategory[findingCategory(f)]++;

    if (!f.current_action) {
      undecidedCount++;
    } else if (f.current_action.action === "dismiss") {
      dismissedCount++;
    } else {
      includedCount++;
    }

    // Dismissing a finding is the associate saying it isn't real exposure,
    // so the total reads as "how much is still on the table."
    if (f.current_action?.action !== "dismiss") {
      totalExposure += f.exposure_amount ?? 0;
    }
  }

  const exposureCurrency = currencyOf(findings.find((f) => f.exposure_amount != null)?.exposure_formula);
  const hasExposure = findings.some((f) => f.exposure_amount != null);
  return {
    total: findings.length,
    byCategory,
    undecidedCount,
    includedCount,
    dismissedCount,
    totalExposure,
    hasExposure,
    exposureCurrency,
  };
}

/** The findings on one clause, shown as one card. */
export interface ClauseGroup<F> {
  clause_type: string;
  /** The most severe finding's severity, which is what the card is ranked and coloured by. */
  severity: FindingSeverity;
  findings: F[];
}

/**
 * A section's findings as one group per clause, the most severe clause first.
 * Clauses of equal severity keep the order they first appear in, and each
 * group keeps the order its findings came in.
 */
export function groupByClause<F extends { clause_type: string; severity: FindingSeverity }>(findings: F[]): ClauseGroup<F>[] {
  const groups = new Map<string, ClauseGroup<F>>();
  for (const finding of findings) {
    const group = groups.get(finding.clause_type);
    if (!group) {
      groups.set(finding.clause_type, { clause_type: finding.clause_type, severity: finding.severity, findings: [finding] });
    } else {
      group.findings.push(finding);
      if (SEVERITY_ORDER[finding.severity] < SEVERITY_ORDER[group.severity]) group.severity = finding.severity;
    }
  }
  // Array.prototype.sort is stable, so equal severities stay in first-seen order.
  return [...groups.values()].sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
}

/**
 * The review's reading order with each clause's findings together: business,
 * then legal, each clause by clause, then other by severity. The screen lists
 * findings in this order, so stepping through them with the keyboard follows
 * what is on screen.
 */
export function inClauseOrder<F extends { clause_type: string; severity: FindingSeverity; category?: Category | null }>(findings: F[]): F[] {
  const sorted = [...findings].sort(compareFindings);
  const of = (category: Category) => sorted.filter((f) => findingCategory(f) === category);
  return [
    ...groupByClause(of("business")).flatMap((group) => group.findings),
    ...groupByClause(of("legal")).flatMap((group) => group.findings),
    ...of("other"),
  ];
}
