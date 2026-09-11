import { describe, expect, it } from "vitest";
import { hashStandards } from "@/lib/standards/load";
import { STANDARDS_LIBRARY } from "@/lib/standards/v1";
import type { StandardEntry } from "@/lib/standards/types";

/**
 * The hash is what makes a finding traceable to the exact library that produced
 * it, now that the database is the source of truth and an admin edit does not
 * change the version string. So it has to depend on content and nothing else:
 * a row arriving in a different order from Postgres must not look like a
 * library revision, and a real wording change must never look identical.
 */

function entry(over: Partial<StandardEntry> = {}): StandardEntry {
  return {
    clause_type: "attrition",
    segment: "default",
    position: "Cumulative measurement, 70% threshold.",
    fallback_language: "Attrition liability will be calculated cumulatively.",
    walk_away_condition: "",
    severity_default: "high",
    version: "v1-industry-default",
    provenance: "extracted",
    ...over,
  };
}

describe("hashStandards", () => {
  it("is stable for the same content", () => {
    expect(hashStandards(STANDARDS_LIBRARY)).toBe(hashStandards(STANDARDS_LIBRARY));
  });

  it("ignores row order, which Postgres does not guarantee", () => {
    const a = entry({ clause_type: "attrition" });
    const b = entry({ clause_type: "cancellation" });
    const c = entry({ clause_type: "force_majeure" });

    const canonical = hashStandards([a, b, c]);
    expect(hashStandards([c, a, b])).toBe(canonical);
    expect(hashStandards([b, c, a])).toBe(canonical);
    expect(hashStandards([c, b, a])).toBe(canonical);
  });

  it("distinguishes entries that differ only by segment", () => {
    const base = entry({ segment: "default" });
    const corporate = entry({ segment: "corporate" });
    expect(hashStandards([base])).not.toBe(hashStandards([corporate]));
  });

  it("changes when any substantive field changes", () => {
    const baseline = hashStandards([entry()]);

    const fields: Array<Partial<StandardEntry>> = [
      { position: "Night-by-night measurement is acceptable." },
      { fallback_language: "Different replacement wording." },
      { walk_away_condition: "Below 60% pickup." },
      { severity_default: "low" },
      { provenance: "cd_validated" },
      { version: "v2" },
    ];

    for (const change of fields) {
      expect(hashStandards([entry(change)]), `changing ${Object.keys(change)[0]}`).not.toBe(baseline);
    }
  });

  it("does not collide when content moves between adjacent fields", () => {
    // A naive concatenation would hash "ab" + "" the same as "a" + "b".
    const split = entry({ position: "a", fallback_language: "b" });
    const joined = entry({ position: "ab", fallback_language: "" });
    expect(hashStandards([split])).not.toBe(hashStandards([joined]));
  });

  it("detects a dropped entry", () => {
    const full = STANDARDS_LIBRARY;
    const short = STANDARDS_LIBRARY.slice(0, -1);
    expect(hashStandards(full)).not.toBe(hashStandards(short));
  });
});

/**
 * clause_type is a plain string, so the compiler no longer catches a typo in
 * the bundled library. These checks take over that job.
 */
describe("the bundled library", () => {
  it("names every clause type in snake_case", () => {
    for (const e of STANDARDS_LIBRARY) {
      expect(e.clause_type, e.clause_type).toMatch(/^[a-z][a-z0-9]*(_[a-z0-9]+)*$/);
    }
  });

  it("has one entry per clause type and segment", () => {
    const keys = STANDARDS_LIBRARY.map((e) => `${e.clause_type}/${e.segment}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
