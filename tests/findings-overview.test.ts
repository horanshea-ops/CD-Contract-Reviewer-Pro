import { describe, expect, it } from "vitest";
import { compareFindings, computeFindingsOverview, groupByClause, inClauseOrder } from "@/lib/findings-overview";

const finding = (over: Partial<Parameters<typeof computeFindingsOverview>[0][number]> = {}) => ({
  severity: "medium" as "high" | "medium" | "low" | "note",
  exposure_amount: null,
  current_action: null,
  ...over,
});

describe("computing a review's overview stats", () => {
  it("buckets findings by category, reading old rows' Other from their severity", () => {
    const overview = computeFindingsOverview([
      finding({ category: "business" }),
      finding({ category: "legal", severity: "high" }),
      finding({ category: "legal" }),
      finding({ category: "other", severity: "note" }),
      finding({ severity: "note" }),
      finding({ severity: "high" }),
    ]);
    expect(overview.total).toBe(6);
    expect(overview.byCategory).toEqual({ business: 2, legal: 2, other: 2 });
  });

  it("orders business, then legal, then other, each by severity", () => {
    const list = [
      finding({ category: "other", severity: "note" }),
      finding({ category: "legal", severity: "low" }),
      finding({ category: "business", severity: "low" }),
      finding({ category: "legal", severity: "high" }),
      finding({ category: "business", severity: "high" }),
    ];
    expect([...list].sort(compareFindings).map((f) => `${f.category}/${f.severity}`)).toEqual([
      "business/high",
      "business/low",
      "legal/high",
      "legal/low",
      "other/note",
    ]);
  });

  it("counts undecided, included and dismissed separately", () => {
    const overview = computeFindingsOverview([
      finding({ current_action: null }),
      finding({ current_action: { action: "accept" } }),
      finding({ current_action: { action: "edit" } }),
      finding({ current_action: { action: "dismiss" } }),
    ]);
    expect(overview.undecidedCount).toBe(1);
    expect(overview.includedCount).toBe(2);
    expect(overview.dismissedCount).toBe(1);
  });

  // Dismissing a finding is the associate saying it isn't real exposure, so
  // the total reads as "how much is still on the table."
  it("excludes a dismissed finding's exposure from the total", () => {
    const overview = computeFindingsOverview([
      finding({ exposure_amount: 10_000, current_action: null }),
      finding({ exposure_amount: 5_000, current_action: { action: "accept" } }),
      finding({ exposure_amount: 50_000, current_action: { action: "dismiss" } }),
    ]);
    expect(overview.totalExposure).toBe(15_000);
  });

  it("treats a missing exposure amount as zero, not NaN", () => {
    const overview = computeFindingsOverview([finding({ exposure_amount: null })]);
    expect(overview.totalExposure).toBe(0);
  });

  // With no figure anywhere, a total of zero would claim nothing is at stake.
  it("reports no exposure when no finding has a figure", () => {
    const overview = computeFindingsOverview([finding(), finding({ current_action: { action: "accept" } })]);
    expect(overview.hasExposure).toBe(false);
  });

  it("reports exposure when one finding has a figure", () => {
    const overview = computeFindingsOverview([finding(), finding({ exposure_amount: 2_500 })]);
    expect(overview.hasExposure).toBe(true);
    expect(overview.totalExposure).toBe(2_500);
  });

  it("keeps the total when the only figure was dismissed", () => {
    const overview = computeFindingsOverview([finding({ exposure_amount: 8_000, current_action: { action: "dismiss" } })]);
    expect(overview.hasExposure).toBe(true);
    expect(overview.totalExposure).toBe(0);
  });

  it("handles an empty review", () => {
    const overview = computeFindingsOverview([]);
    expect(overview).toEqual({
      total: 0,
      byCategory: { business: 0, legal: 0, other: 0 },
      undecidedCount: 0,
      includedCount: 0,
      dismissedCount: 0,
      totalExposure: 0,
      exposureCurrency: "$",
      hasExposure: false,
    });
  });

  it("totals exposures in the currency their formulas are written in", () => {
    const overview = computeFindingsOverview([
      { severity: "medium", exposure_amount: null, current_action: null },
      { severity: "medium", exposure_amount: 13000, exposure_formula: "€20000 * (1 - 0.35)", current_action: null },
    ]);
    expect(overview).toMatchObject({ totalExposure: 13000, exposureCurrency: "€" });
  });
});

describe("one card per clause", () => {
  const f = (clause_type: string, severity: "high" | "medium" | "low" | "note", category: "business" | "legal" | "other" = "business") => ({
    clause_type,
    severity,
    category,
  });

  it("groups a section's findings by clause, the most severe clause first", () => {
    const groups = groupByClause([f("cutoff_date", "medium"), f("cancellation", "medium"), f("rebates", "low"), f("cancellation", "high"), f("cutoff_date", "medium")]);

    expect(groups.map((g) => [g.clause_type, g.severity, g.findings.length])).toEqual([
      ["cancellation", "high", 2],
      ["cutoff_date", "medium", 2],
      ["rebates", "low", 1],
    ]);
    // Inside a group the findings keep the order they came in.
    expect(groups[0].findings.map((x) => x.severity)).toEqual(["medium", "high"]);
  });

  it("keeps clauses of equal severity in the order they first appear", () => {
    const groups = groupByClause([f("rebates", "medium"), f("cutoff_date", "medium"), f("rebates", "medium")]);
    expect(groups.map((g) => g.clause_type)).toEqual(["rebates", "cutoff_date"]);
  });

  it("lists findings clause by clause within business and legal, and leaves other by severity", () => {
    const ordered = inClauseOrder([
      f("general", "note", "other"),
      f("force_majeure", "high", "legal"),
      f("cutoff_date", "medium"),
      f("cancellation", "high"),
      f("governing_law_venue", "medium", "legal"),
      f("cutoff_date", "low"),
      f("cancellation", "medium"),
      f("force_majeure", "medium", "legal"),
    ]);

    expect(ordered.map((x) => `${x.clause_type}/${x.severity}`)).toEqual([
      "cancellation/high",
      "cancellation/medium",
      "cutoff_date/medium",
      "cutoff_date/low",
      "force_majeure/high",
      "force_majeure/medium",
      "governing_law_venue/medium",
      "general/note",
    ]);
  });
});
