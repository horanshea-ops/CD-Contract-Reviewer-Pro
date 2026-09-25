import { outlineOf, leadingNumber, type Section } from "../contract-outline";
import { normalizeText } from "../docx/normalize";
import { similarityOf } from "../text-similarity";
/**
 * Only the part's name and its text are read here — never the run elements —
 * so the parameter is this structural shape rather than WalkResult. A
 * WalkResult[] still satisfies it, and §1.7.7 can locate against plain
 * reconstructed text without a DOCX behind it.
 */
export interface LocatablePart {
  part: string;
  text: string;
}
import type { LocateResult, LocatedSpan } from "./types";

/**
 * Finding the wording a model quoted, in the document (MASTER_PLAN.md §1.5.1).
 *
 * Three tiers, tried in order, and the tier is recorded so a weak match is
 * visible rather than assumed: exact, then whitespace- and case-insensitive
 * (with table separators ignored as a last resort), then fuzzy at a
 * similarity of 0.95 or better.
 *
 * **The model is never asked where the text is.** Models are unreliable at
 * counting characters; matching here is deterministic and free.
 *
 * **A quote that appears twice is disambiguated by the finding's section
 * reference, and marked unresolved if that does not separate them.** The engine
 * this replaces took the first match, which is how a short repeated phrase gets
 * the wrong clause redlined. Redlining nothing is recoverable; redlining the
 * wrong clause is sent to a hotel.
 */

/** Below this, a fuzzy match is not a match. */
const FUZZY_THRESHOLD = 0.95;

/** Two candidates closer than this in score are treated as tied, not ranked. */
const TIE_EPSILON = 0.01;

interface Projection {
  /** Lower-cased, whitespace-collapsed text. */
  text: string;
  /** For each character here, its index in the part's original text. */
  origin: number[];
}

/**
 * Collapses whitespace and case, keeping a way back to the original offsets.
 *
 * Matching has to tolerate a model rewrapping a quote across lines, but the
 * offsets handed to the rest of the engine must point into the real text, so
 * every projected character remembers where it came from. With `skipPipes`,
 * the "|" that separates table cells counts as whitespace too.
 */
function project(text: string, skipPipes = false): Projection {
  let out = "";
  const origin: number[] = [];
  let inWhitespace = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (/\s/.test(ch) || (skipPipes && ch === "|")) {
      if (!inWhitespace && out.length > 0) {
        out += " ";
        origin.push(i);
      }
      inWhitespace = true;
      continue;
    }
    inWhitespace = false;
    out += ch.toLowerCase();
    origin.push(i);
  }
  return { text: out, origin };
}

/** Maps a match in the projection back to a range in the original text. */
function toOriginalRange(p: Projection, start: number, length: number): { start: number; end: number } {
  return { start: p.origin[start], end: p.origin[start + length - 1] + 1 };
}

interface Candidate {
  part: string;
  /** Half-open range in the part's original text — what the rest of the engine uses. */
  start: number;
  end: number;
  similarity: number;
  /** The part's text, for ranking a candidate against the section headings around it. */
  text: string;
}

/** Every place `needle` occurs in `haystack`. */
function allOccurrences(haystack: string, needle: string): number[] {
  const out: number[] = [];
  if (!needle) return out;
  let from = 0;
  for (;;) {
    const at = haystack.indexOf(needle, from);
    if (at === -1) return out;
    out.push(at);
    from = at + 1;
  }
}

/**
 * Windows worth scoring, anchored on the quote's rarest word.
 *
 * Scoring every substring of a 200KB contract is far too slow. The rarest word
 * in the quote is almost always present in a near-match, so its occurrences
 * give a short list of places to look, each probed at a few offsets to absorb
 * the length difference a fuzzy match implies.
 */
function fuzzyCandidates(projection: Projection, quote: string, part: string, text: string): Candidate[] {
  const words = quote.split(" ").filter((w) => w.length >= 3);
  if (!words.length) return [];

  const rarest = words
    .map((w) => ({ word: w, count: allOccurrences(projection.text, w).length }))
    .filter((w) => w.count > 0)
    .sort((a, b) => a.count - b.count)[0];
  if (!rarest) return [];

  const offsetInQuote = quote.indexOf(rarest.word);
  const out: Candidate[] = [];

  for (const at of allOccurrences(projection.text, rarest.word)) {
    // A fuzzy match can be a little shorter or longer than the quote, and the
    // anchor can have drifted, so probe a few starts and a few lengths.
    for (const startShift of [-4, -2, 0, 2, 4]) {
      const start = at - offsetInQuote + startShift;
      if (start < 0 || start >= projection.text.length) continue;
      for (const lengthShift of [-0.06, 0, 0.06]) {
        const length = Math.round(quote.length * (1 + lengthShift));
        if (length <= 0 || start + length > projection.text.length) continue;
        const window = projection.text.slice(start, start + length);
        const similarity = similarityOf(quote, window);
        if (similarity < FUZZY_THRESHOLD) continue;
        const range = toOriginalRange(projection, start, length);
        out.push({ part, ...range, similarity, text });
      }
    }
  }
  return out;
}

/** Drops candidates that overlap a better-scoring one — the same hit probed twice. */
function dedupe(candidates: Candidate[]): Candidate[] {
  const sorted = [...candidates].sort((a, b) => b.similarity - a.similarity);
  const kept: Candidate[] = [];
  for (const c of sorted) {
    const overlaps = kept.some((k) => k.part === c.part && c.start < k.end && c.end > k.start);
    if (!overlaps) kept.push(c);
  }
  return kept;
}

const words = (s: string) =>
  project(normalizeText(s)).text.replace(/[^a-z0-9 ]+/g, " ").split(" ").filter((w) => w.length >= 3);

/** Does this heading look like the section the finding names? */
function anchorMatches(anchor: Section, sectionNumber: string | null, sectionWords: string[]): boolean {
  if (sectionNumber && anchor.number === sectionNumber) return true;
  if (!sectionWords.length) return false;
  const anchorWords = new Set(words(anchor.label));
  return sectionWords.every((w) => anchorWords.has(w));
}

/**
 * Picks the candidate sitting in the section the finding names.
 *
 * Returns null when the section is unknown, names no heading in the document,
 * or does not separate the candidates — in which case the finding goes
 * unresolved rather than being guessed at.
 */
function disambiguate(candidates: Candidate[], locationSection: string | null): Candidate | null {
  if (!locationSection) return null;

  const sectionNumber = leadingNumber(locationSection.replace(/^\s*section\s+/i, ""));
  const sectionWords = words(locationSection).filter((w) => w !== "section");

  const inSection: Candidate[] = [];
  for (const candidate of candidates) {
    const section = outlineOf(candidate.text).find((a) => anchorMatches(a, sectionNumber, sectionWords));
    if (!section) continue;
    if (candidate.start >= section.start && candidate.start < section.end) inSection.push(candidate);
  }

  // More than one hit inside the same section is still ambiguous.
  return inSection.length === 1 ? inSection[0] : null;
}

function decide(
  candidates: Candidate[],
  locationSection: string | null,
  resolution: LocatedSpan["resolution"]
): LocateResult | null {
  if (candidates.length === 0) return null;

  if (candidates.length === 1) {
    const c = candidates[0];
    return { part: c.part, start: c.start, end: c.end, resolution, similarity: c.similarity };
  }

  const picked = disambiguate(candidates, locationSection);
  if (picked) {
    return { part: picked.part, start: picked.start, end: picked.end, resolution, similarity: picked.similarity };
  }
  return {
    resolution: "unresolved",
    ambiguous: true,
    reason:
      `The quoted wording appears ${candidates.length} times in the contract and the finding's ` +
      `section reference does not say which one is meant.`,
  };
}

export function locateQuote(
  parts: LocatablePart[],
  quotedText: string | null,
  locationSection: string | null
): LocateResult {
  const raw = (quotedText ?? "").trim();
  if (!raw) return { resolution: "unresolved", reason: "The finding quotes no wording to mark up." };

  const projections = new Map<string, Projection>();
  for (const part of parts) projections.set(part.part, project(part.text));

  // Tier 1 — exact, on the text as extracted.
  const exact: Candidate[] = [];
  for (const part of parts) {
    for (const at of allOccurrences(part.text, raw)) {
      exact.push({ part: part.part, start: at, end: at + raw.length, similarity: 1, text: part.text });
    }
  }
  const exactResult = decide(exact, locationSection, "exact");
  if (exactResult) return exactResult;

  // Tier 2 — whitespace and case set aside. A model rewraps and recapitalises.
  const quote = project(normalizeText(raw)).text;
  const normalized: Candidate[] = [];
  for (const part of parts) {
    const projection = projections.get(part.part)!;
    for (const at of allOccurrences(projection.text, quote)) {
      normalized.push({
        part: part.part,
        ...toOriginalRange(projection, at, quote.length),
        similarity: 1,
        text: part.text,
      });
    }
  }
  const normalizedResult = decide(normalized, locationSection, "normalized");
  if (normalizedResult) return normalizedResult;

  // Still tier 2, with table separators set aside as well. The "|" between
  // cells is our layout rather than the contract's, and a quote that runs
  // across cells may leave it out.
  const acrossCells: Candidate[] = [];
  const cellQuote = project(normalizeText(raw), true).text;
  for (const part of parts) {
    if (!part.text.includes("|")) continue;
    const projection = project(part.text, true);
    for (const at of allOccurrences(projection.text, cellQuote)) {
      acrossCells.push({
        part: part.part,
        ...toOriginalRange(projection, at, cellQuote.length),
        similarity: 1,
        text: part.text,
      });
    }
  }
  const acrossCellsResult = decide(acrossCells, locationSection, "normalized");
  if (acrossCellsResult) return acrossCellsResult;

  // Tier 3 — fuzzy, for a quote the model reworded slightly.
  const fuzzy: Candidate[] = [];
  for (const part of parts) {
    fuzzy.push(...fuzzyCandidates(projections.get(part.part)!, quote, part.part, part.text));
  }
  const best = dedupe(fuzzy);
  if (best.length === 0) {
    return { resolution: "unresolved", reason: "The quoted wording could not be found in the document." };
  }

  // Only a genuinely close second is ambiguous; a clear winner is the answer.
  const contenders = best.filter((c) => best[0].similarity - c.similarity <= TIE_EPSILON);
  return decide(contenders, locationSection, "fuzzy")!;
}
