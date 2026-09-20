/**
 * Edit distance and the similarity ratio read from it.
 *
 * Shared by §1.5's span location (lib/redline-engine/locate.ts) and §2.1.1's
 * round diff, which pairs blocks of text by how close they are. One
 * implementation, so the two cannot disagree about what "close" means.
 */

/** Levenshtein distance, two rows rather than a full matrix. */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  let curr = new Array<number>(b.length + 1);

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    const ca = a[i - 1];
    for (let j = 1; j <= b.length; j++) {
      const cost = ca === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[b.length];
}

/** 1 for identical text, 0 for nothing in common. Two empty strings are identical. */
export function similarityOf(a: string, b: string): number {
  const longest = Math.max(a.length, b.length);
  if (longest === 0) return 1;
  return 1 - levenshtein(a, b) / longest;
}
