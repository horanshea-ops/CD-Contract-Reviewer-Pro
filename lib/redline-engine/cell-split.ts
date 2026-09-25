/**
 * Lays a proposal back out across the table cells its quote covers.
 *
 * A proposal for wording that runs across cells normally separates the cells
 * with "|". One written without them is compared with the cells word by word,
 * and each change goes to the cell it falls inside.
 *
 * Returns null when a change can't be placed in exactly one cell: it replaces
 * words from two cells, or it adds words on the line between two cells. A
 * rewrite does both. Guessing there would put wording in the wrong column.
 *
 * The comparison is a plain longest-common-subsequence over words. The redline's
 * own word diff merges nearby changes to read well, which would join changes
 * in neighbouring cells into one that crosses the line between them.
 */

interface CellWord {
  text: string;
  cell: number;
}

/** Past this, the comparison table costs more than a table row is worth. */
const MAX_TABLE_CELLS = 250_000;

export function splitAcrossCells(cells: string[], proposal: string): string[] | null {
  if (cells.length < 2) return [proposal];

  const a: CellWord[] = cells.flatMap((cell, index) => wordsOf(cell).map((text) => ({ text, cell: index })));
  const b = wordsOf(proposal);
  if (a.length === 0 || (a.length + 1) * (b.length + 1) > MAX_TABLE_CELLS) return null;

  const out: string[][] = cells.map(() => []);
  let i = 0;
  let j = 0;

  const placeGap = (iEnd: number, jEnd: number): boolean => {
    const removed = a.slice(i, iEnd);
    const added = b.slice(j, jEnd);
    if (removed.length === 0 && added.length === 0) return true;

    let owner: number;
    if (removed.length > 0) {
      owner = removed[0].cell;
      if (removed.some((w) => w.cell !== owner)) return false;
    } else {
      // A pure insertion belongs to a cell only when words of that cell sit on
      // both sides of it, or it opens the first cell or closes the last.
      const before = a[i - 1]?.cell;
      const after = a[i]?.cell;
      if (before === undefined) owner = 0;
      else if (after === undefined) owner = cells.length - 1;
      else if (before === after) owner = before;
      else return false;
    }
    out[owner].push(...added);
    return true;
  };

  for (const [pi, pj] of commonWords(a.map((w) => w.text), b)) {
    if (!placeGap(pi, pj)) return null;
    out[a[pi].cell].push(a[pi].text);
    i = pi + 1;
    j = pj + 1;
  }
  if (!placeGap(a.length, b.length)) return null;

  return out.map((words) => words.join(" "));
}

const wordsOf = (s: string) => s.split(/\s+/).filter(Boolean);

/** Pairs of matching word indices, in order. */
function commonWords(a: string[], b: string[]): [number, number][] {
  const width = b.length + 1;
  const table = new Uint32Array((a.length + 1) * width);
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      table[i * width + j] =
        a[i] === b[j] ? table[(i + 1) * width + j + 1] + 1 : Math.max(table[(i + 1) * width + j], table[i * width + j + 1]);
    }
  }

  const pairs: [number, number][] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      pairs.push([i, j]);
      i++;
      j++;
    } else if (table[(i + 1) * width + j] >= table[i * width + j + 1]) i++;
    else j++;
  }
  return pairs;
}
