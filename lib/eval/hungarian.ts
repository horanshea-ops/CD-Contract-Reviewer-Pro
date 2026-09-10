/**
 * Maximum-weight bipartite assignment (MASTER_PLAN.md §2.0.1).
 *
 * The eval harness pairs answer-key items with model findings. Greedy
 * first-best-match is not good enough: a finding that is the best candidate for
 * two key items can only take one, and taking the wrong one costs a second pair
 * that a different arrangement would have kept. The result is an accuracy
 * number that is lower than the truth for a reason nothing reports.
 *
 * So the pairing is solved optimally. Corpora are small (tens of items per
 * document), O(n³) is free at that size, and the alternative is a number nobody
 * can trust.
 *
 * **Weights are non-negative integers, and zero means "not a pair."** Integers
 * because the potentials below accumulate, and float drift in an optimiser is
 * exactly the kind of bug this module exists to avoid. Zero rather than a
 * sentinel because the padding an assignment problem needs is already worth
 * zero, so an ineligible pair and a padded cell behave identically and no
 * "large negative" constant has to be tuned.
 */

export interface Assignment {
  /** Column paired with each row, or -1 where the row is unpaired. */
  rowsToCols: number[];
  /** Row paired with each column, or -1 where the column is unpaired. */
  colsToRows: number[];
  /** Sum of the weights of the chosen pairs. Optimal by construction. */
  totalWeight: number;
}

function validate(weights: readonly (readonly number[])[]): { rows: number; cols: number } {
  const rows = weights.length;
  const cols = rows === 0 ? 0 : weights[0].length;

  for (const [i, row] of weights.entries()) {
    if (row.length !== cols) {
      throw new Error(`maxWeightAssignment: row ${i} has ${row.length} columns, expected ${cols}.`);
    }
    for (const [j, w] of row.entries()) {
      if (!Number.isInteger(w) || w < 0) {
        throw new Error(
          `maxWeightAssignment: weight at [${i}][${j}] is ${w}. Weights must be non-negative integers.`
        );
      }
    }
  }
  return { rows, cols };
}

/**
 * Pairs rows with columns so the total weight is as large as possible.
 *
 * Shortest-augmenting-path assignment with dual potentials, on the cost matrix
 * `-weight` padded square. Every padded cell costs zero, so a perfect matching
 * of the padded square always exists and its value is the sum of the real pairs
 * it uses — which makes minimising cost there the same problem as maximising
 * weight over partial matchings here.
 *
 * Ties are broken by column order, so the answer is deterministic for a given
 * matrix. It is NOT invariant to permuting the input: two different optimal
 * pairings can have the same total weight, and which one comes back depends on
 * the order rows and columns arrive in. Callers that need a stable answer sort
 * their inputs first — see matchDocument in ./match.
 */
export function maxWeightAssignment(weights: readonly (readonly number[])[]): Assignment {
  const { rows, cols } = validate(weights);

  const rowsToCols = new Array<number>(rows).fill(-1);
  const colsToRows = new Array<number>(cols).fill(-1);
  if (rows === 0 || cols === 0) return { rowsToCols, colsToRows, totalWeight: 0 };

  const n = Math.max(rows, cols);
  const cost = (i: number, j: number) => (i <= rows && j <= cols ? -weights[i - 1][j - 1] : 0);

  const INF = Number.POSITIVE_INFINITY;

  // u and v are the dual potentials, p[j] the row currently holding column j,
  // and way[j] the column this augmenting path reached j from. Index 0 is the
  // algorithm's scratch slot, not a real row or column.
  const u = new Array<number>(n + 1).fill(0);
  const v = new Array<number>(n + 1).fill(0);
  const p = new Array<number>(n + 1).fill(0);
  const way = new Array<number>(n + 1).fill(0);

  for (let i = 1; i <= n; i++) {
    p[0] = i;
    let j0 = 0;
    const minv = new Array<number>(n + 1).fill(INF);
    const used = new Array<boolean>(n + 1).fill(false);

    // Grow the alternating tree until it reaches a free column.
    do {
      used[j0] = true;
      const i0 = p[j0];
      let delta = INF;
      let j1 = 0;

      for (let j = 1; j <= n; j++) {
        if (used[j]) continue;
        const cur = cost(i0, j) - u[i0] - v[j];
        if (cur < minv[j]) {
          minv[j] = cur;
          way[j] = j0;
        }
        if (minv[j] < delta) {
          delta = minv[j];
          j1 = j;
        }
      }

      for (let j = 0; j <= n; j++) {
        if (used[j]) {
          u[p[j]] += delta;
          v[j] -= delta;
        } else {
          minv[j] -= delta;
        }
      }
      j0 = j1;
    } while (p[j0] !== 0);

    // Walk the path back, flipping each edge.
    do {
      const j1 = way[j0];
      p[j0] = p[j1];
      j0 = j1;
    } while (j0 !== 0);
  }

  let totalWeight = 0;
  for (let j = 1; j <= n; j++) {
    const i = p[j];
    if (i === 0 || i > rows || j > cols) continue;

    // A padded perfect matching can pair a row with a column it has no business
    // being paired with. Zero weight is what "no business" means, so drop it.
    const w = weights[i - 1][j - 1];
    if (w === 0) continue;

    rowsToCols[i - 1] = j - 1;
    colsToRows[j - 1] = i - 1;
    totalWeight += w;
  }

  return { rowsToCols, colsToRows, totalWeight };
}
