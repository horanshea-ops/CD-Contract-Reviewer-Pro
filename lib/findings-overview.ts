/**
 * A review's whole-list stats — severity counts, decision counts, total
 * exposure — for the overview bar above the findings list (ROADMAP item 7).
 *
 * Takes a narrow structural type rather than importing `Finding` from the
 * review screen, so this stays a plain lib module other code can import
 * without a lib-depends-on-app edge.
 */

export type FindingSeverity = "high" | "medium" | "low" | "note";

export const SEVERITY_ORDER: Record<FindingSeverity, number> = { high: 0, medium: 1, low: 2, note: 3 };

interface FindingLike {
  severity: FindingSeverity;
  exposure_amount: number | null;
  current_action: { action: "accept" | "edit" | "dismiss" } | null;
}

export interface FindingsOverview {
  total: number;
  bySeverity: Record<FindingSeverity, number>;
  undecidedCount: number;
  includedCount: number;
  dismissedCount: number;
  totalExposure: number;
}

export function computeFindingsOverview(findings: FindingLike[]): FindingsOverview {
  const bySeverity: Record<FindingSeverity, number> = { high: 0, medium: 0, low: 0, note: 0 };
  let undecidedCount = 0;
  let includedCount = 0;
  let dismissedCount = 0;
  let totalExposure = 0;

  for (const f of findings) {
    bySeverity[f.severity]++;

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

  return { total: findings.length, bySeverity, undecidedCount, includedCount, dismissedCount, totalExposure };
}
