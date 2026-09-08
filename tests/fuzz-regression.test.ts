import { describe, expect, it } from "vitest";
import { runOne } from "@/scripts/fuzz-tracked-changes";

/**
 * Seeds that produced a corrupt document before the structural-boundary gate
 * was widened (lib/tracked-changes-docx.ts).
 *
 * Randomised testing found a 16% corruption rate on realistic redlines — the
 * engine spliced across `</w:ins>` and `</w:sdtContent>` boundaries and emitted
 * XML that does not parse, which is a file Word refuses to open. Fifteen
 * hand-built fixtures had not caught it; documents carrying the counterparty's
 * own tracked changes are where it bites, i.e. every round after the first.
 *
 * These seeds are pinned so the specific documents that broke it are exercised
 * on every run, not just whatever a fresh random batch happens to produce.
 */
const KNOWN_BAD_SEEDS = [
  331351351, 490586304, 12210920, 437977807, 943008115,
  925442885, 4996595, 781557499, 136225542, 909336843,
  883923416, 958887589, 789806075, 3771954, 292093241,
];

describe("tracked-changes fuzz regressions", () => {
  it.each(KNOWN_BAD_SEEDS)("seed %i produces a valid, rejectable document", async (seed) => {
    const r = await runOne(seed);
    expect(r.failures, `seed ${seed}`).toEqual([]);
  });

  it("still applies redlines rather than refusing everything", async () => {
    // A gate that refused every span would pass every invariant above while
    // making the feature useless, so assert the engine is doing real work.
    const results = await Promise.all(
      Array.from({ length: 40 }, (_, i) => runOne(1_000 + i * 7919))
    );
    const applied = results.filter((r) => (r.applied ?? 0) > 0).length;
    const failed = results.filter((r) => r.failures.length > 0);
    expect(failed).toEqual([]);
    expect(applied).toBeGreaterThan(10);
  });
});
