import { isSynthetic, type MapEntry } from "../docx/types";

/**
 * The view of a contract that a round diff compares (MASTER_PLAN.md §2.1.1).
 *
 * §1.4's extracted text carries list numbers, heading hashes and table pipes as
 * synthetic characters — structure the extractor invented, not wording anyone
 * agreed to. A property that inserts one clause renumbers every clause after
 * it, and a diff that reads those numbers reports hundreds of changes for one
 * edit. So the projection drops synthetic structure and collapses whitespace,
 * keeping an origin for every character so a match maps back to real offsets.
 *
 * Two projectors, because a baseline is not always a DOCX. `projectMapped` is
 * exact and reads the source map; `projectPlain` reads the same structure off
 * the text itself for a round stored only as text. **Both sides of one diff
 * must use the same projector** — mixing them would report the difference
 * between the two projectors as a difference between the two documents.
 */

export interface Projection {
  /** Contract wording only, single-spaced. */
  text: string;
  /** For each character here, its offset in the text it was projected from. */
  origin: number[];
}

class Builder {
  private chars: string[] = [];
  private origin: number[] = [];
  /** A separator is owed before the next character, unless nothing precedes it. */
  private pending = false;

  push(ch: string, at: number) {
    if (this.pending && this.chars.length > 0) {
      this.chars.push(" ");
      this.origin.push(at);
    }
    this.pending = false;
    this.chars.push(ch);
    this.origin.push(at);
  }

  separate() {
    this.pending = true;
  }

  finish(): Projection {
    return { text: this.chars.join(""), origin: this.origin };
  }
}

/**
 * Projects extracted text using its source map, which says exactly which
 * characters are synthetic.
 *
 * A no-break hyphen is the one synthetic character that is contract wording —
 * "night-by-night" reads as a hyphenated phrase and must keep its hyphen. It is
 * told apart from a bullet marker by what precedes it, since a bullet opens a
 * paragraph and a hyphen sits inside one.
 */
export function projectMapped(text: string, map: MapEntry[]): Projection {
  if (map.length !== text.length) {
    throw new Error(`Source map is ${map.length} entries for ${text.length} characters of text.`);
  }

  const out = new Builder();
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (isSynthetic(map[i])) {
      if (ch === "-" && i > 0 && !isSynthetic(map[i - 1])) out.push(ch, i);
      else out.separate();
      continue;
    }
    if (/\s/.test(ch)) out.separate();
    else out.push(ch, i);
  }
  return out.finish();
}

/** A table's separator row — structure, with no wording in it at all. */
const TABLE_RULE = /^[ \t]*\|(?:[ \t]*-{3,}[ \t]*\|)+[ \t]*$/;
const HEADING_MARK = /^[ \t]*#{1,6}[ \t]+/;
/** One level of a list label: "3", "a" or "iv". */
const LABEL_LEVEL = String.raw`(?:\d+|[ivxlcdm]+|[A-Za-z])`;
/**
 * A list label as §1.4 renders one — "2.", "5.2.", "a)", "1.a", "1.a.i", or a
 * bullet. A single-level label has to carry its punctuation to count, so a
 * paragraph opening "A deposit is due" keeps its first word.
 */
const LIST_LABEL = new RegExp(
  String.raw`^[ \t]*(?:[-•]|${LABEL_LEVEL}(?:\.${LABEL_LEVEL})+[.)]?|${LABEL_LEVEL}[.)])[ \t]+`,
  "i"
);

/**
 * Projects text with no source map behind it, reading the same structure off
 * the characters. Used for a round stored only as text, and for a PDF-route
 * round rebuilt from positioned lines.
 *
 * Less exact than the mapped projector by construction — a line opening with a
 * number is assumed to be a numbered clause — so a diff built on it is reported
 * at lower confidence rather than presented as the same answer.
 */
export function projectPlain(text: string): Projection {
  const out = new Builder();
  let lineStart = 0;

  while (lineStart <= text.length) {
    const brk = text.indexOf("\n", lineStart);
    const lineEnd = brk === -1 ? text.length : brk;
    const line = text.slice(lineStart, lineEnd);

    if (!TABLE_RULE.test(line)) {
      const isTableRow = line.trimStart().startsWith("|");
      const prefix = HEADING_MARK.exec(line)?.[0] ?? LIST_LABEL.exec(line)?.[0] ?? "";

      for (let i = prefix.length; i < line.length; i++) {
        const ch = line[i];
        if (/\s/.test(ch) || (isTableRow && ch === "|")) out.separate();
        else out.push(ch, lineStart + i);
      }
    }

    out.separate();
    if (brk === -1) break;
    lineStart = brk + 1;
  }
  return out.finish();
}

/**
 * Turns a half-open range in the projection into one in the source text.
 *
 * Leading and trailing separators are trimmed off first, so a region's range
 * starts and ends on real wording rather than on the space standing in for a
 * paragraph break. An empty range answers a zero-width position, which is where
 * an insertion belongs.
 */
export function toSourceRange(
  projection: Projection,
  start: number,
  end: number
): { start: number; end: number } {
  let from = start;
  let to = end;
  while (from < to && projection.text[from] === " ") from++;
  while (to > from && projection.text[to - 1] === " ") to--;

  if (from >= to) {
    const at = projection.origin[Math.min(start, projection.origin.length - 1)];
    return { start: at ?? 0, end: at ?? 0 };
  }
  return { start: projection.origin[from], end: projection.origin[to - 1] + 1 };
}
