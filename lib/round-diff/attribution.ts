import type { ExtractedPart, MarkupSpan, RevisionInfo } from "../docx/types";
import type { Range, RegionKind } from "./diff";

/**
 * Who made a change, when the returned document still carries Word's revision
 * marks (MASTER_PLAN.md §2.1.1).
 *
 * This never decides *what* changed. A property that accepts our edits before
 * making their own leaves no mark on the accepted edits at all, so a reader of
 * revision marks alone would report them as untouched. The text diff is the
 * authority on what moved; these marks say who moved it and when.
 *
 * Offsets here are in the part's accepted-view text — the same text §1.4 hands
 * the model and §1.5 locates against — so a diff region's range indexes
 * straight into them.
 */

export interface RevisionMark {
  /** Half-open range in the accepted-view text. Zero-width for a deletion. */
  start: number;
  end: number;
  revision: RevisionInfo;
  /** The wording, as it reads in whichever view holds it. */
  text: string;
}

export type Side = "ours" | "theirs" | "unknown";

export class AcceptedViewDrift extends Error {}

/** A revision is visible in the accepted view unless it took text out of it. */
const inAcceptedView = (span: MarkupSpan) =>
  span.synthetic || !span.revision || span.revision.kind === "ins" || span.revision.kind === "moveTo";

/**
 * Every revision in a part, placed in its accepted-view text.
 *
 * The markup spans and the accepted-view text come out of the same single walk
 * (lib/docx/walk.ts), so concatenating the spans that belong to that view must
 * reproduce the text exactly. It is checked rather than assumed: a mismatch
 * means every offset after it is wrong, and attributing a change to the wrong
 * author is the silent failure worth throwing over. The caller degrades to an
 * unattributed diff rather than reporting a guess.
 */
export function revisionMarks(part: ExtractedPart): RevisionMark[] {
  const marks: RevisionMark[] = [];
  let at = 0;
  let rebuilt = "";

  for (const span of part.markup) {
    if (!inAcceptedView(span)) {
      // A deletion is not in this view, so it sits at a point rather than over
      // a range — the place where the wording used to be.
      if (span.revision) marks.push({ start: at, end: at, revision: span.revision, text: span.text });
      continue;
    }

    if (span.revision) {
      marks.push({ start: at, end: at + span.text.length, revision: span.revision, text: span.text });
    }
    rebuilt += span.text;
    at += span.text.length;
  }

  if (rebuilt !== part.text) {
    throw new AcceptedViewDrift(
      `The markup of part "${part.part}" rebuilds to ${rebuilt.length} characters of accepted view, ` +
        `but the part holds ${part.text.length}. Revision offsets cannot be trusted.`
    );
  }
  return marks;
}

/** Merges the marks of several parts, offset by where each part's text starts. */
export function marksAcrossParts(parts: { part: ExtractedPart; offset: number }[]): RevisionMark[] {
  return parts.flatMap(({ part, offset }) =>
    revisionMarks(part).map((mark) => ({ ...mark, start: mark.start + offset, end: mark.end + offset }))
  );
}

const overlaps = (mark: RevisionMark, range: Range) =>
  mark.start === mark.end
    ? mark.start >= range.start && mark.start <= range.end
    : mark.start < range.end && mark.end > range.start;

/** The authors whose revisions touch a range, in the order they appear. */
export function authorsIn(marks: RevisionMark[], range: Range): string[] {
  const seen = new Set<string>();
  for (const mark of marks) {
    if (!overlaps(mark, range)) continue;
    if (mark.revision.author) seen.add(mark.revision.author);
  }
  return [...seen];
}

const sameName = (a: string, b: string) =>
  a.trim().replace(/\s+/g, " ").toLowerCase() === b.trim().replace(/\s+/g, " ").toLowerCase();

/**
 * Whether a revision author is us or the counterparty.
 *
 * "Unknown" is a real answer and is kept separate from "theirs". A document
 * edited on a shared machine carries whatever name Word was configured with,
 * and calling that the property is a guess dressed as a fact.
 */
export function classifyAuthor(author: string, ours: string[]): Side {
  if (!author.trim()) return "unknown";
  return ours.some((name) => sameName(name, author)) ? "ours" : "theirs";
}

export interface OurChangeFate {
  /** Where the change we made sits in the baseline's accepted-view text. */
  range: Range;
  text: string;
  author: string;
  /** Share of it still present in what came back, 1 untouched and 0 entirely gone. */
  retained: number;
}

/**
 * What became of the changes we made in the round we sent.
 *
 * Purely a statement about spans of text — a range we inserted is still there,
 * or part of it is not. It deliberately says nothing about findings: turning
 * "this wording is gone" into "the property rejected this finding" is §2.1.2's
 * job, and that section is gated.
 */
export function fateOfOurChanges(
  baselineMarks: RevisionMark[],
  ours: string[],
  regions: { kind: RegionKind; baseline: Range }[]
): OurChangeFate[] {
  const inserted = baselineMarks.filter(
    (mark) =>
      mark.end > mark.start &&
      (mark.revision.kind === "ins" || mark.revision.kind === "moveTo") &&
      classifyAuthor(mark.revision.author, ours) === "ours"
  );

  return inserted.map((mark) => {
    const length = mark.end - mark.start;
    let touched = 0;
    for (const region of regions) {
      if (region.kind === "insert") continue;
      const from = Math.max(mark.start, region.baseline.start);
      const to = Math.min(mark.end, region.baseline.end);
      if (to > from) touched += to - from;
    }
    return {
      range: { start: mark.start, end: mark.end },
      text: mark.text,
      author: mark.revision.author,
      retained: length === 0 ? 1 : Math.max(0, (length - touched) / length),
    };
  });
}
