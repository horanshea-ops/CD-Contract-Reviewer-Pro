import { similarityOf } from "../text-similarity";

/**
 * What changed between two projections of a contract (MASTER_PLAN.md §2.1.1).
 *
 * Word tokens, not characters or lines. A contract is prose in long paragraphs,
 * so a line diff reports whole paragraphs as changed when one percentage moved,
 * and a character diff reports the letters "s", "e", "v" arriving inside a
 * word. A word is the unit an associate reads a change in.
 *
 * Alignment is patience diff — match the tokens that appear exactly once on
 * each side, take the longest rising run of those, and recurse into the gaps.
 * It anchors on the rare wording rather than on the "the"s and "shall"s, which
 * is what keeps a change reported against the clause it actually happened in.
 * Where a gap holds no unique token, a bounded Myers pass finishes it, and a
 * gap too tangled even for that is reported whole rather than guessed at.
 *
 * Everything here works in the projected character space its inputs are in.
 * Mapping back to the document is the caller's job.
 */

/** Ops closer together than this belong to one edit an associate would read as one. */
const MERGE_GAP = 2;
/** Beyond this many edits in one gap, report the gap whole instead. */
const MYERS_MAX_D = 400;
/** How alike a deletion and an insertion must be to be one clause that moved. */
const MOVE_SIMILARITY = 0.9;
/** Shorter than this, two matching stretches are a common phrase, not a move. */
const MOVE_MIN_CHARS = 24;
/** Below this share of the baseline surviving, the two documents are not the same draft. */
const REBASE_FLOOR = 0.4;

export type RegionKind = "insert" | "delete" | "replace" | "move";

export interface Range {
  start: number;
  end: number;
}

export interface DiffRegion {
  kind: RegionKind;
  /** Half-open range in the baseline text. Zero-width where nothing was there. */
  baseline: Range;
  /** Half-open range in the returned text. Zero-width where nothing is there now. */
  returned: Range;
  baselineText: string;
  returnedText: string;
  /** For a move, the index of the region holding the other end of it. */
  moveCounterpart?: number;
}

export interface DiffResult {
  regions: DiffRegion[];
  /** Share of the baseline's words that came back untouched, 0 to 1. */
  retained: number;
  /**
   * True when too little of the baseline survived for a region-by-region
   * answer to mean anything — the property worked from a different draft.
   */
  rebased: boolean;
}

interface Token {
  text: string;
  start: number;
  end: number;
}

/** One edit, in token indices. Equal stretches are the gaps between these. */
interface Op {
  aStart: number;
  aEnd: number;
  bStart: number;
  bEnd: number;
}

export function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  let at = 0;

  while (at < text.length) {
    while (at < text.length && text[at] === " ") at++;
    if (at >= text.length) break;
    const start = at;
    while (at < text.length && text[at] !== " ") at++;
    tokens.push({ text: text.slice(start, at), start, end: at });
  }
  return tokens;
}

/**
 * Longest rising run through a list of pairs, by patience sorting.
 *
 * The pairs come in ascending order of their first index, so the longest run
 * that also rises in the second index is the longest set of anchors that can
 * hold at once without crossing.
 */
function longestRisingRun(pairs: [number, number][]): [number, number][] {
  if (pairs.length === 0) return [];

  const piles: number[] = [];
  const backlinks = new Array<number>(pairs.length).fill(-1);
  const tops: number[] = [];

  for (let i = 0; i < pairs.length; i++) {
    const value = pairs[i][1];
    let lo = 0;
    let hi = piles.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (pairs[tops[mid]][1] < value) lo = mid + 1;
      else hi = mid;
    }
    if (lo > 0) backlinks[i] = tops[lo - 1];
    tops[lo] = i;
    piles[lo] = value;
  }

  const out: [number, number][] = [];
  for (let i = tops[piles.length - 1]; i !== -1; i = backlinks[i]) out.push(pairs[i]);
  return out.reverse();
}

/** Tokens appearing exactly once on each side, paired up in baseline order. */
function uniqueAnchors(a: Token[], aLo: number, aHi: number, b: Token[], bLo: number, bHi: number) {
  const countA = new Map<string, number>();
  const countB = new Map<string, number>();
  const whereA = new Map<string, number>();
  const whereB = new Map<string, number>();

  for (let i = aLo; i < aHi; i++) {
    countA.set(a[i].text, (countA.get(a[i].text) ?? 0) + 1);
    whereA.set(a[i].text, i);
  }
  for (let i = bLo; i < bHi; i++) {
    countB.set(b[i].text, (countB.get(b[i].text) ?? 0) + 1);
    whereB.set(b[i].text, i);
  }

  const pairs: [number, number][] = [];
  for (const [text, count] of countA) {
    if (count !== 1 || countB.get(text) !== 1) continue;
    pairs.push([whereA.get(text)!, whereB.get(text)!]);
  }
  pairs.sort((x, y) => x[0] - y[0]);
  return longestRisingRun(pairs);
}

/**
 * Myers' greedy edit script for a gap with no unique anchor in it.
 *
 * Returns null once the gap needs more than `MYERS_MAX_D` edits, which on a
 * contract means the two stretches have nothing much to do with each other.
 * The caller then reports the gap as one replacement rather than an invented
 * word-by-word correspondence.
 */
function myers(a: Token[], aLo: number, aHi: number, b: Token[], bLo: number, bHi: number): Op[] | null {
  const n = aHi - aLo;
  const m = bHi - bLo;
  const maxD = Math.min(MYERS_MAX_D, n + m);
  const offset = maxD;
  const v = new Array<number>(2 * maxD + 1).fill(0);
  const trace: number[][] = [];

  for (let d = 0; d <= maxD; d++) {
    trace.push(v.slice());
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1])
        ? v[offset + k + 1]
        : v[offset + k - 1] + 1;
      let y = x - k;
      while (x < n && y < m && a[aLo + x].text === b[bLo + y].text) { x++; y++; }
      v[offset + k] = x;
      if (x >= n && y >= m) return walkBack(trace, a, aLo, b, bLo, n, m, d, offset);
    }
  }
  return null;
}

/** Follows the trace back to the start, collecting the edits it took. */
function walkBack(
  trace: number[][],
  a: Token[],
  aLo: number,
  b: Token[],
  bLo: number,
  n: number,
  m: number,
  d: number,
  offset: number
): Op[] {
  const ops: Op[] = [];
  let x = n;
  let y = m;

  for (let step = d; step > 0; step--) {
    const v = trace[step];
    const k = x - y;
    const fromK = k === -step || (k !== step && v[offset + k - 1] < v[offset + k + 1]) ? k + 1 : k - 1;
    const prevX = v[offset + fromK];
    const prevY = prevX - fromK;

    while (x > prevX && y > prevY) { x--; y--; }

    if (x > prevX) ops.push({ aStart: aLo + prevX, aEnd: aLo + x, bStart: bLo + y, bEnd: bLo + y });
    else if (y > prevY) ops.push({ aStart: aLo + x, aEnd: aLo + x, bStart: bLo + prevY, bEnd: bLo + y });

    x = prevX;
    y = prevY;
  }
  return ops.reverse();
}

function align(a: Token[], aLo: number, aHi: number, b: Token[], bLo: number, bHi: number, out: Op[]) {
  while (aLo < aHi && bLo < bHi && a[aLo].text === b[bLo].text) { aLo++; bLo++; }
  while (aLo < aHi && bLo < bHi && a[aHi - 1].text === b[bHi - 1].text) { aHi--; bHi--; }

  if (aLo === aHi && bLo === bHi) return;
  if (aLo === aHi || bLo === bHi) {
    out.push({ aStart: aLo, aEnd: aHi, bStart: bLo, bEnd: bHi });
    return;
  }

  const anchors = uniqueAnchors(a, aLo, aHi, b, bLo, bHi);
  if (anchors.length === 0) {
    const ops = myers(a, aLo, aHi, b, bLo, bHi);
    if (ops) out.push(...ops);
    else out.push({ aStart: aLo, aEnd: aHi, bStart: bLo, bEnd: bHi });
    return;
  }

  let ai = aLo;
  let bi = bLo;
  for (const [ax, bx] of anchors) {
    align(a, ai, ax, b, bi, bx, out);
    ai = ax + 1;
    bi = bx + 1;
  }
  align(a, ai, aHi, b, bi, bHi, out);
}

/** Half-open character range covering a token range, empty ranges pinned to a position. */
function span(tokens: Token[], start: number, end: number, fallbackAt: number): Range {
  if (start >= end) {
    const at = start < tokens.length ? tokens[start].start : (tokens[tokens.length - 1]?.end ?? fallbackAt);
    return { start: at, end: at };
  }
  return { start: tokens[start].start, end: tokens[end - 1].end };
}

/** Joins ops an associate would read as one edit, and turns them into regions. */
function toRegions(ops: Op[], a: Token[], b: Token[], baseline: string, returned: string): DiffRegion[] {
  const merged: Op[] = [];
  for (const op of ops) {
    const last = merged[merged.length - 1];
    const gap = last ? Math.max(op.aStart - last.aEnd, op.bStart - last.bEnd) : Infinity;
    if (last && gap <= MERGE_GAP) {
      last.aEnd = Math.max(last.aEnd, op.aEnd);
      last.bEnd = Math.max(last.bEnd, op.bEnd);
    } else {
      merged.push({ ...op });
    }
  }

  return merged.map((op) => {
    const baselineRange = span(a, op.aStart, op.aEnd, baseline.length);
    const returnedRange = span(b, op.bStart, op.bEnd, returned.length);
    const removed = op.aEnd > op.aStart;
    const added = op.bEnd > op.bStart;

    return {
      kind: removed && added ? "replace" : removed ? "delete" : "insert",
      baseline: baselineRange,
      returned: returnedRange,
      baselineText: baseline.slice(baselineRange.start, baselineRange.end),
      returnedText: returned.slice(returnedRange.start, returnedRange.end),
    } satisfies DiffRegion;
  });
}

/**
 * Pairs a deletion with a matching insertion elsewhere, so a clause the
 * property moved reads as a move rather than as a loss and an unrelated gain.
 * §1.4 already treats a Word move as a move; this keeps the diff consistent
 * with it.
 */
function markMoves(regions: DiffRegion[]) {
  const deletes = regions
    .map((r, i) => ({ r, i }))
    .filter(({ r }) => r.kind === "delete" && r.baselineText.length >= MOVE_MIN_CHARS);
  const inserts = regions
    .map((r, i) => ({ r, i }))
    .filter(({ r }) => r.kind === "insert" && r.returnedText.length >= MOVE_MIN_CHARS);

  const candidates: { score: number; from: number; to: number }[] = [];
  for (const d of deletes) {
    for (const ins of inserts) {
      const score = similarityOf(d.r.baselineText, ins.r.returnedText);
      if (score >= MOVE_SIMILARITY) candidates.push({ score, from: d.i, to: ins.i });
    }
  }
  candidates.sort((x, y) => y.score - x.score || x.from - y.from);

  const taken = new Set<number>();
  for (const { from, to } of candidates) {
    if (taken.has(from) || taken.has(to)) continue;
    taken.add(from);
    taken.add(to);
    regions[from] = { ...regions[from], kind: "move", moveCounterpart: to };
    regions[to] = { ...regions[to], kind: "move", moveCounterpart: from };
  }
}

export function diffProjections(baseline: string, returned: string): DiffResult {
  const a = tokenize(baseline);
  const b = tokenize(returned);

  const ops: Op[] = [];
  align(a, 0, a.length, b, 0, b.length, ops);

  const regions = toRegions(ops, a, b, baseline, returned);
  markMoves(regions);

  const touched = ops.reduce((sum, op) => sum + (op.aEnd - op.aStart), 0);
  const retained = a.length === 0 ? (b.length === 0 ? 1 : 0) : (a.length - touched) / a.length;

  return { regions, retained, rebased: retained < REBASE_FLOOR };
}
