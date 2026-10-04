import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { extractDocx } from "@/lib/docx";
import { positionsFrom } from "@/lib/exposures/cd-positions";
import { attritionExposure, cancellationExposure, fbMinimumExposure } from "@/lib/exposures/compute";
import { readFigures } from "@/lib/exposures/figures";
import { mustRaise } from "@/lib/must-raise";
import { EXPOSURE_CATALOG } from "@/lib/review";
import { STANDARDS_LIBRARY } from "@/lib/standards/v1";
import { validateTerms } from "@/lib/terms/validate";

/** CD's numbers, as the bundled standards library states them. */
const CD = positionsFrom(STANDARDS_LIBRARY).positions;

/**
 * Real reader answers, replayed through everything the app does with them:
 * the checks against the contract, the figures, the exposures, and the
 * findings the app raises itself. A change to any of those is tried against
 * what a model actually returned, at no cost.
 *
 * Each fixture is one reading call's answer, saved as the reader gave it.
 * Harborview is synthetic and committed. A real contract's fixture sits under
 * data/private/, which git ignores, and its case is skipped where the file is
 * absent. scripts/save-reading.ts makes one from a stored review.
 */

interface Fixture {
  contract: string;
  entries: unknown[];
}

async function replay(fixturePath: string, contractPath: string) {
  const fixture: Fixture = JSON.parse(readFileSync(fixturePath, "utf8"));
  const { parts } = await extractDocx(new Uint8Array(readFileSync(contractPath)));
  const terms = validateTerms(fixture.entries, EXPOSURE_CATALOG, parts);
  const { figures, notes } = readFigures(terms);
  return {
    terms,
    figures,
    notes,
    exposures: {
      attrition: attritionExposure(figures, CD)?.amount ?? null,
      cancellation: cancellationExposure(figures, CD)?.amount ?? null,
      fb_minimum: fbMinimumExposure(figures, CD)?.amount ?? null,
    },
    // What the app would raise if the judging call wrote nothing at all.
    raised: mustRaise(figures, terms, [], STANDARDS_LIBRARY),
  };
}

describe("Harborview, as Sonnet 5.5 read it on 2026-10-04", () => {
  const run = () =>
    replay(path.join("tests", "fixtures", "readings", "harborview-sonnet-5-5.json"), path.join("data", "sample-contracts", "eval", "eval-01-harborview.docx"));

  it("takes the block's total from the nightly table, which the contract never adds up", async () => {
    const { figures, terms } = await run();
    expect(terms.stated.find((t) => t.term_key === "deal.room_block_room_nights")).toMatchObject({ value: 680, verification: "verified" });
    expect(figures).toMatchObject({
      room_block_room_nights: 680,
      group_rate: 289,
      attrition_threshold_pct: 0.9,
      attrition_damages_pct: 1,
      fb_shortfall_pct: 1,
      cancellation_tiers: [{ room_pct: 1, base: "room_block", charges: "rate" }],
    });
  });

  it("gives the attrition and cancellation exposures", async () => {
    const { exposures } = await run();
    // Attrition: (90% of 680 - 70% of 680) nights at $289. Cancellation: 680 nights at $289, less the 70% CD's standard would charge.
    expect(exposures).toEqual({ attrition: 39304, cancellation: 58956, fb_minimum: null });
  });

  it("raises the attrition threshold and the F&B shortfall rate itself", async () => {
    const { raised } = await run();
    expect(raised.uncovered).toEqual([]);
    expect(raised.findings.map((f) => [f.clause_type, f.headline])).toEqual([
      ["attrition", "Attrition applies below 90% pickup, above the 70% standard"],
      ["fb_minimum", "Food and beverage shortfall is charged at 100%, above the 35% standard"],
    ]);
    expect(raised.findings[0].proposed_language).toContain("seventy percent (70%)");
    expect(raised.findings[1].proposed_language).toContain("thirty-five percent (35%)");
  });
});

const FLORIDA = path.join("data", "private", "readings", "9244158e.json");
const FLORIDA_CONTRACT = path.join("data", "private", "florida-property-round1.docx");

describe.skipIf(!existsSync(FLORIDA) || !existsSync(FLORIDA_CONTRACT))("Florida, as Sonnet 5.5 read it on 2026-10-04", () => {
  it("gives attrition and F&B, and no cancellation figure because the reader answered other", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { exposures, figures, notes } = await replay(FLORIDA, FLORIDA_CONTRACT);

    expect(figures).toMatchObject({ room_block_room_nights: 2900, group_rate: 149, minimum_room_nights: 2280, fb_minimum: 80000 });
    expect(exposures).toEqual({ attrition: 29800, cancellation: null, fb_minimum: 36000 });
    expect(notes.map((n) => n.term_key)).toEqual(["cancellation.damages_basis"]);
  });

  it("raises the attrition floor and the F&B shortfall itself, with the numbers changed", async () => {
    const { raised } = await replay(FLORIDA, FLORIDA_CONTRACT);
    expect(raised.findings.map((f) => f.clause_type)).toEqual(["attrition", "fb_minimum"]);
    expect(raised.findings[0].proposed_language).toContain("2,030");
    expect(raised.findings[1].proposed_language).toContain("35%");
  });
});
