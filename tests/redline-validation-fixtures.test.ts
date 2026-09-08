import { describe, expect, it } from "vitest";
import { generateTrackedChangesDocx } from "@/lib/tracked-changes-docx";
import { validateRedline } from "@/lib/redline-validation";
import { FIXTURE_AUTHOR, FIXTURE_CORPUS, readFixture } from "./helpers/fixture-corpus";

/**
 * The oracle against the §1.11 fixture corpus (MASTER_PLAN.md §1.6.6).
 *
 * "Measure this against the 12-fixture corpus before it is measured against
 * real contracts." A fallback here means an associate would be handed a PDF
 * instead of a redline on a document we built ourselves, so the corpus rate has
 * to be zero before the pilot rate means anything.
 */

async function runFixture(index: number) {
  const { file, findings } = FIXTURE_CORPUS[index];
  const originalBytes = new Uint8Array(await readFixture(file));
  const engineResult = await generateTrackedChangesDocx({
    originalDocxBytes: originalBytes,
    findings,
    author: FIXTURE_AUTHOR,
  });
  const report = await validateRedline({ originalBytes, engineResult, author: FIXTURE_AUTHOR });
  return { file, report };
}

describe("the fixture corpus through the oracle", () => {
  it.each(FIXTURE_CORPUS.map((c, i) => [i, c.file] as const))(
    "%i %s validates without falling back",
    async (index) => {
      const { report } = await runFixture(index);
      expect(report.checks.filter((c) => !c.passed)).toEqual([]);
      expect(report.outcome).not.toBe("fallback");
    }
  );

  it("has a zero fallback rate across the whole corpus", async () => {
    const reports = await Promise.all(FIXTURE_CORPUS.map((_, i) => runFixture(i)));
    const fallbacks = reports.filter((r) => r.report.outcome === "fallback");
    expect(fallbacks.map((r) => r.file)).toEqual([]);
  });

  it("still reaches Partial, so the degraded path is exercised and not assumed", async () => {
    const reports = await Promise.all(FIXTURE_CORPUS.map((_, i) => runFixture(i)));
    const partial = reports.filter((r) => r.report.outcome === "partial");
    expect(partial.length).toBeGreaterThan(0);
    for (const r of partial) {
      // Every unapplied finding carries a reason an associate can act on.
      for (const u of r.report.unapplied) expect(u.reason).toBeTruthy();
    }
  });
});
