import { describe, expect, it } from "vitest";
import { computeFindingsOverview } from "@/lib/findings-overview";

const finding = (over: Partial<Parameters<typeof computeFindingsOverview>[0][number]> = {}) => ({
  severity: "medium" as const,
  exposure_amount: null,
  current_action: null,
  ...over,
});

describe("computing a review's overview stats", () => {
  it("buckets findings by severity", () => {
    const overview = computeFindingsOverview([
      finding({ severity: "high" }),
      finding({ severity: "high" }),
      finding({ severity: "low" }),
      finding({ severity: "note" }),
    ]);
    expect(overview.total).toBe(4);
    expect(overview.bySeverity).toEqual({ high: 2, medium: 0, low: 1, note: 1 });
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

  it("handles an empty review", () => {
    const overview = computeFindingsOverview([]);
    expect(overview).toEqual({
      total: 0,
      bySeverity: { high: 0, medium: 0, low: 0, note: 0 },
      undecidedCount: 0,
      includedCount: 0,
      dismissedCount: 0,
      totalExposure: 0,
    });
  });
});
