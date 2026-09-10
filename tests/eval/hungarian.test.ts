import { describe, it, expect } from "vitest";
import { maxWeightAssignment } from "@/lib/eval/hungarian";

/**
 * The optimiser is checked against exhaustive search, not against examples.
 *
 * An assignment bug does not crash — it returns a slightly worse pairing, which
 * reads downstream as a slightly worse model. Nothing else in the harness would
 * ever catch that, so the property has to be proven rather than sampled.
 */

/** Every partial matching, scored. Correct by inspection, far too slow for real sizes. */
function bruteForceBest(weights: number[][]): number {
  const rows = weights.length;
  const cols = rows === 0 ? 0 : weights[0].length;
  const takenCol = new Array<boolean>(cols).fill(false);

  function best(row: number): number {
    if (row === rows) return 0;
    let bestTotal = best(row + 1); // leave this row unpaired
    for (let col = 0; col < cols; col++) {
      if (takenCol[col] || weights[row][col] === 0) continue;
      takenCol[col] = true;
      bestTotal = Math.max(bestTotal, weights[row][col] + best(row + 1));
      takenCol[col] = false;
    }
    return bestTotal;
  }
  return best(0);
}

/** Deterministic PRNG, so a failing case is reproducible from its seed alone. */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function assertConsistent(result: ReturnType<typeof maxWeightAssignment>, weights: number[][]) {
  const seenCols = new Set<number>();
  let recomputed = 0;

  for (const [row, col] of result.rowsToCols.entries()) {
    if (col === -1) continue;
    expect(seenCols.has(col), `column ${col} used twice`).toBe(false);
    seenCols.add(col);
    expect(weights[row][col]).toBeGreaterThan(0);
    expect(result.colsToRows[col]).toBe(row);
    recomputed += weights[row][col];
  }

  for (const [col, row] of result.colsToRows.entries()) {
    if (row === -1) continue;
    expect(result.rowsToCols[row]).toBe(col);
  }

  expect(recomputed).toBe(result.totalWeight);
}

describe("maxWeightAssignment", () => {
  it("returns nothing for an empty matrix", () => {
    expect(maxWeightAssignment([])).toEqual({ rowsToCols: [], colsToRows: [], totalWeight: 0 });
  });

  it("handles a matrix with rows but no columns", () => {
    const result = maxWeightAssignment([[], []]);
    expect(result.rowsToCols).toEqual([-1, -1]);
    expect(result.totalWeight).toBe(0);
  });

  it("pairs a single eligible cell", () => {
    const result = maxWeightAssignment([[7]]);
    expect(result.rowsToCols).toEqual([0]);
    expect(result.colsToRows).toEqual([0]);
    expect(result.totalWeight).toBe(7);
  });

  it("never pairs a zero-weight cell, even when padding forces a full matching", () => {
    const result = maxWeightAssignment([
      [0, 0],
      [0, 0],
    ]);
    expect(result.rowsToCols).toEqual([-1, -1]);
    expect(result.colsToRows).toEqual([-1, -1]);
    expect(result.totalWeight).toBe(0);
  });

  it("leaves a row unpaired when its only eligible column is worth more elsewhere", () => {
    // Row 0 can only take column 0. Row 1 prefers column 0 but can also take
    // column 1, so the optimum gives column 0 to row 0.
    const weights = [
      [5, 0],
      [9, 4],
    ];
    const result = maxWeightAssignment(weights);
    expect(result.totalWeight).toBe(9);
    expect(result.rowsToCols).toEqual([0, 1]);
  });

  it("beats greedy on a matrix built to defeat it", () => {
    // Greedy takes the single largest cell (row 0, column 0, worth 10) and is
    // then left with 1, for 11. Standing back gives 9 + 8 = 17.
    const weights = [
      [10, 9],
      [8, 1],
    ];
    const result = maxWeightAssignment(weights);
    expect(result.totalWeight).toBe(17);
    expect(result.rowsToCols).toEqual([1, 0]);
  });

  it("handles more rows than columns", () => {
    const weights = [[3, 1], [1, 4], [9, 9]];
    const result = maxWeightAssignment(weights);
    assertConsistent(result, weights);
    expect(result.totalWeight).toBe(bruteForceBest(weights));
    expect(result.rowsToCols.filter((c) => c !== -1)).toHaveLength(2);
  });

  it("handles more columns than rows", () => {
    const weights = [[3, 1, 9], [1, 4, 2]];
    const result = maxWeightAssignment(weights);
    assertConsistent(result, weights);
    expect(result.totalWeight).toBe(bruteForceBest(weights));
  });

  it("rejects a ragged matrix", () => {
    expect(() => maxWeightAssignment([[1, 2], [3]])).toThrow(/row 1 has 1 columns/);
  });

  it("rejects negative and fractional weights", () => {
    expect(() => maxWeightAssignment([[-1]])).toThrow(/non-negative integers/);
    expect(() => maxWeightAssignment([[1.5]])).toThrow(/non-negative integers/);
    expect(() => maxWeightAssignment([[Number.NaN]])).toThrow(/non-negative integers/);
  });

  it("matches exhaustive search on 1000 random matrices", () => {
    const random = mulberry32(20260909);
    for (let trial = 0; trial < 1000; trial++) {
      const rows = 1 + Math.floor(random() * 6);
      const cols = 1 + Math.floor(random() * 6);
      const weights: number[][] = [];
      for (let i = 0; i < rows; i++) {
        const row: number[] = [];
        for (let j = 0; j < cols; j++) {
          // Roughly a third ineligible, so sparsity is exercised too.
          row.push(random() < 0.35 ? 0 : 1 + Math.floor(random() * 50));
        }
        weights.push(row);
      }

      const result = maxWeightAssignment(weights);
      assertConsistent(result, weights);
      expect(result.totalWeight, `trial ${trial}: ${JSON.stringify(weights)}`).toBe(
        bruteForceBest(weights)
      );
    }
  });

  it("finds the same total weight however the matrix is permuted", () => {
    const random = mulberry32(11235);
    for (let trial = 0; trial < 200; trial++) {
      const rows = 2 + Math.floor(random() * 4);
      const cols = 2 + Math.floor(random() * 4);
      const weights: number[][] = [];
      for (let i = 0; i < rows; i++) {
        weights.push(
          Array.from({ length: cols }, () => (random() < 0.3 ? 0 : 1 + Math.floor(random() * 20)))
        );
      }

      const rowOrder = [...weights.keys()].sort(() => random() - 0.5);
      const colOrder = [...Array(cols).keys()].sort(() => random() - 0.5);
      const shuffled = rowOrder.map((i) => colOrder.map((j) => weights[i][j]));

      expect(maxWeightAssignment(shuffled).totalWeight).toBe(maxWeightAssignment(weights).totalWeight);
    }
  });

  it("stays fast at corpus scale", () => {
    const random = mulberry32(777);
    const weights = Array.from({ length: 60 }, () =>
      Array.from({ length: 60 }, () => (random() < 0.5 ? 0 : 1 + Math.floor(random() * 1000)))
    );
    const start = Date.now();
    const result = maxWeightAssignment(weights);
    expect(Date.now() - start).toBeLessThan(1000);
    assertConsistent(result, weights);
  });
});
