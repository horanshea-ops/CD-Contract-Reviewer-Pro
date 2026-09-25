import { diffProjections } from "./round-diff/diff";

/**
 * A finding's change as struck, added and unchanged stretches.
 *
 * The proposal repeats every quoted word it keeps, so printing the quote and
 * the proposal in full shows the same clause twice and leaves the reader to
 * find the difference. The review card shows the quote once with the changes
 * marked, and folds long unchanged stretches down to their ends.
 */

export type Segment = { kind: "same" | "del" | "ins"; text: string };

/** Unchanged stretches longer than this fold down to their first and last few words. */
const FOLD_OVER_WORDS = 20;
const FOLD_KEEP_WORDS = 6;

const flat = (s: string) => s.replace(/\s+/g, " ").trim();

export function changeSegments(quote: string, language: string): Segment[] {
  const before = flat(quote);
  const after = flat(language);
  const { regions } = diffProjections(before, after);
  const ordered = [...regions].sort((x, y) => x.baseline.start - y.baseline.start || x.returned.start - y.returned.start);

  const segments: Segment[] = [];
  let cursor = 0;
  for (const r of ordered) {
    if (r.baseline.start > cursor) segments.push({ kind: "same", text: before.slice(cursor, r.baseline.start) });
    if (r.baselineText.trim()) segments.push({ kind: "del", text: r.baselineText.trim() });
    if (r.returnedText.trim()) segments.push({ kind: "ins", text: r.returnedText.trim() });
    cursor = Math.max(cursor, r.baseline.end);
  }
  if (cursor < before.length) segments.push({ kind: "same", text: before.slice(cursor) });
  return segments;
}

/** An unchanged stretch cut down to the words next to the changes around it. */
export function fold(text: string, first: boolean, last: boolean): string {
  const words = text.trim().split(" ");
  if (words.length <= FOLD_OVER_WORDS) return text;
  const lead = text.startsWith(" ") ? " " : "";
  const trail = text.endsWith(" ") ? " " : "";
  const head = words.slice(0, FOLD_KEEP_WORDS).join(" ");
  const tail = words.slice(-FOLD_KEEP_WORDS).join(" ");
  if (first) return `… ${tail}${trail}`;
  if (last) return `${lead}${head} …`;
  return `${lead}${head} … ${tail}${trail}`;
}
