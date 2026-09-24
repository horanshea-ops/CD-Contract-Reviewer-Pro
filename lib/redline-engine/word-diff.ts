/**
 * Which words a proposal changes.
 *
 * The passage and the proposal are compared word by word, where a word is
 * anything between spaces, so "(12)" or "hours." changes as a unit and is
 * never struck a character at a time. Two rules keep the result readable:
 *
 * - A proposal that keeps less than half the passage's words is a rewrite. It
 *   comes back as one change covering everything, because a rewrite diffed
 *   word by word is a scatter of fragments.
 * - Fewer than three shared words between two changes join them into one, so a
 *   lone "the" never sits between two edits.
 *
 * Shared wording keeps the contract's own spacing.
 */

export interface WordChange {
  /** Half-open range in the passage. Equal ends mean a pure insertion. */
  from: number;
  to: number;
  /** What replaces the range. Empty means a pure deletion. */
  text: string;
}

const MIN_KEPT_SHARE = 0.5;
const MIN_WORDS_BETWEEN_CHANGES = 3;

/** Past this, the comparison table costs more than the result is worth. */
const MAX_TABLE_CELLS = 4_000_000;

interface Word {
  text: string;
  start: number;
  end: number;
}

function wordsOf(s: string): Word[] {
  return [...s.matchAll(/\S+/g)].map((m) => ({ text: m[0], start: m.index!, end: m.index! + m[0].length }));
}

/** Pairs of matching word indices, passage then proposal, in order. */
function longestCommon(a: Word[], b: Word[]): [number, number][] {
  const n = a.length;
  const m = b.length;
  const width = m + 1;
  const table = new Uint32Array((n + 1) * width);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      table[i * width + j] =
        a[i].text === b[j].text
          ? table[(i + 1) * width + j + 1] + 1
          : Math.max(table[(i + 1) * width + j], table[i * width + j + 1]);
    }
  }

  // Where a proposal word can be passed over without shortening the match, it
  // is. That pairs a passage word with its last possible partner, so wording
  // added in front of "the rate" reads as an insertion rather than as "the"
  // struck and retyped.
  const pairs: [number, number][] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    const here = table[i * width + j];
    if (a[i].text === b[j].text && table[i * width + j + 1] < here) {
      pairs.push([i, j]);
      i++;
      j++;
    } else if (table[i * width + j + 1] === here) {
      j++;
    } else {
      i++;
    }
  }
  return pairs;
}

/**
 * Drops short stretches of shared words that sit between two changes.
 *
 * A stretch is a run of pairs that follow on in both texts. It sits between
 * two changes when words differ on both sides of it.
 */
function dropShortStretches(pairs: [number, number][], a: Word[], b: Word[]): [number, number][] {
  const stretches: [number, number][][] = [];
  for (const pair of pairs) {
    const last = stretches[stretches.length - 1];
    const previous = last?.[last.length - 1];
    if (previous && pair[0] === previous[0] + 1 && pair[1] === previous[1] + 1) last.push(pair);
    else stretches.push([pair]);
  }

  const kept: [number, number][] = [];
  stretches.forEach((stretch, k) => {
    const [firstA, firstB] = stretch[0];
    const [lastA, lastB] = stretch[stretch.length - 1];
    const before = stretches[k - 1]?.[stretches[k - 1].length - 1] ?? [-1, -1];
    const after = stretches[k + 1]?.[0] ?? [a.length, b.length];
    const changeBefore = firstA - before[0] > 1 || firstB - before[1] > 1;
    const changeAfter = after[0] - lastA > 1 || after[1] - lastB > 1;
    if (changeBefore && changeAfter && stretch.length < MIN_WORDS_BETWEEN_CHANGES) return;
    kept.push(...stretch);
  });
  return kept;
}

const leadingSpace = (s: string) => s.length - s.trimStart().length;
const trailingSpace = (s: string) => s.length - s.trimEnd().length;

/**
 * One change for the gap between two shared words.
 *
 * Spacing that both sides of the gap start or end with stays outside the
 * change, so the struck and inserted words don't carry a stray space each.
 */
function changeForGap(passage: string, proposal: string, from: number, to: number, newFrom: number, newTo: number): WordChange | null {
  let oldText = passage.slice(from, to);
  let newText = proposal.slice(newFrom, newTo);
  if (!oldText.trim() && !newText.trim()) return null;

  if (leadingSpace(oldText) && leadingSpace(newText)) {
    const cut = leadingSpace(oldText);
    from += cut;
    oldText = oldText.slice(cut);
    newText = newText.slice(leadingSpace(newText));
  }
  if (trailingSpace(oldText) && trailingSpace(newText)) {
    const cut = trailingSpace(oldText);
    to -= cut;
    oldText = oldText.slice(0, oldText.length - cut);
    newText = newText.slice(0, newText.length - trailingSpace(newText));
  }
  return { from, to, text: newText };
}

export function wordChanges(passage: string, proposal: string): WordChange[] {
  const whole: WordChange[] = [{ from: 0, to: passage.length, text: proposal }];
  const a = wordsOf(passage);
  const b = wordsOf(proposal);
  if (a.length === 0 || (a.length + 1) * (b.length + 1) > MAX_TABLE_CELLS) return whole;

  const pairs = dropShortStretches(longestCommon(a, b), a, b);
  if (pairs.length < a.length * MIN_KEPT_SHARE) return whole;

  const changes: WordChange[] = [];
  let oldCursor = 0;
  let newCursor = 0;
  for (const [i, j] of pairs) {
    const change = changeForGap(passage, proposal, oldCursor, a[i].start, newCursor, b[j].start);
    if (change) changes.push(change);
    oldCursor = a[i].end;
    newCursor = b[j].end;
  }
  const tail = changeForGap(passage, proposal, oldCursor, passage.length, newCursor, proposal.length);
  if (tail) changes.push(tail);
  return changes;
}
