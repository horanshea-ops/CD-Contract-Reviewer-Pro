import type { SourceRef, WalkResult } from "../docx";
import { refsInSpan } from "./applicability";
import type { LocatedSpan } from "./types";

/**
 * Cutting runs so a span lines up with whole ones (MASTER_PLAN.md §1.5.4).
 *
 * A quote rarely starts and ends where a run does, so the first and last runs
 * it touches are split at its boundaries. After this, the span is exactly a
 * list of complete runs and the deletion can wrap them without touching a
 * character either side.
 *
 * **`w:rPr` is cloned into every piece.** That is the line that preserves
 * formatting; without it bold, italic and font changes silently drop out of the
 * text around an edit — a corruption nobody notices until a hotel does.
 *
 * Everything in a run that is not text — tabs, breaks, symbols, footnote
 * markers — is placed in whichever piece its position falls in, never dropped.
 * The engine this replaces destroyed them, which §1.6's oracle caught at 2-5%
 * of documents.
 */

const childElements = (node: Element): Element[] => {
  const out: Element[] = [];
  for (let i = 0; i < node.childNodes.length; i++) {
    const c = node.childNodes[i];
    if (c.nodeType === 1) out.push(c as Element);
  }
  return out;
};

const TEXT_TAGS = new Set(["w:t", "w:delText"]);

/** A run's text, concatenated across every text child, matching the source map's offsets. */
export function runText(run: Element): string {
  let out = "";
  for (const child of childElements(run)) {
    if (TEXT_TAGS.has(child.nodeName)) out += child.textContent ?? "";
  }
  return out;
}

function emptyRunLike(run: Element): Element {
  const doc = run.ownerDocument!;
  const out = doc.createElement(run.nodeName);
  const attrs = run.attributes;
  for (let i = 0; i < attrs.length; i++) out.setAttribute(attrs[i].name, attrs[i].value);
  return out;
}

function textChild(doc: Document, tagName: string, text: string): Element {
  const el = doc.createElement(tagName);
  el.setAttribute("xml:space", "preserve");
  el.appendChild(doc.createTextNode(text));
  return el;
}

/**
 * Splits one run into up to three, at the span boundaries inside it.
 *
 * One pass over the children, each landing in exactly one bucket, so nothing
 * can be dropped or duplicated by an off-by-one at a boundary.
 */
export function splitRun(run: Element, from: number, to: number): { before: Element | null; middle: Element; after: Element | null } {
  const doc = run.ownerDocument!;
  const length = runText(run).length;

  const before = emptyRunLike(run);
  const middle = emptyRunLike(run);
  const after = emptyRunLike(run);
  let beforeHas = false;
  let afterHas = false;

  let cursor = 0;
  for (const child of childElements(run)) {
    if (child.nodeName === "w:rPr") {
      // Cloned into all three. This is what keeps formatting.
      before.appendChild(child.cloneNode(true));
      middle.appendChild(child.cloneNode(true));
      after.appendChild(child.cloneNode(true));
      continue;
    }

    if (TEXT_TAGS.has(child.nodeName)) {
      const text = child.textContent ?? "";
      const start = cursor;
      cursor += text.length;

      const pieces: [Element, number, number, () => void][] = [
        [before, start, Math.min(from, cursor), () => { beforeHas = true; }],
        [middle, Math.max(from, start), Math.min(to, cursor), () => {}],
        [after, Math.max(to, start), cursor, () => { afterHas = true; }],
      ];
      for (const [target, s, e, mark] of pieces) {
        if (e <= s) continue;
        target.appendChild(textChild(doc, child.nodeName, text.slice(s - start, e - start)));
        mark();
      }
      continue;
    }

    // A tab, break, symbol or footnote marker occupies no characters, so it
    // belongs to the piece its position falls in. The trailing case matters:
    // anything sitting at the very end of the run goes with `after`, which is
    // how it survives when the span reaches the run's last character.
    if (cursor < from) { before.appendChild(child.cloneNode(true)); beforeHas = true; }
    else if (cursor < to || (to >= length && cursor >= from)) { middle.appendChild(child.cloneNode(true)); }
    else { after.appendChild(child.cloneNode(true)); afterHas = true; }
  }

  return { before: beforeHas ? before : null, middle, after: afterHas ? after : null };
}

/** Replaces a run in its parent with the pieces it was split into. */
function replaceRun(run: Element, pieces: (Element | null)[]) {
  const parent = run.parentNode!;
  for (const piece of pieces) {
    if (piece) parent.insertBefore(piece, run);
  }
  parent.removeChild(run);
}

/**
 * Splits what needs splitting and returns the runs the span now covers exactly,
 * in document order.
 *
 * Runs between the first and last that carry no text of their own — a tab-only
 * run, say — are included. They sit inside the wording being replaced, so
 * leaving them out would strike the text around them and leave them behind.
 */
export function runsForSpan(part: WalkResult, span: LocatedSpan): Element[] {
  const refs: SourceRef[] = refsInSpan(part, span);
  if (refs.length === 0) return [];

  const bounds = new Map<number, { min: number; max: number }>();
  for (const ref of refs) {
    const seen = bounds.get(ref.runIndex);
    if (!seen) bounds.set(ref.runIndex, { min: ref.offsetWithinRun, max: ref.offsetWithinRun });
    else {
      seen.min = Math.min(seen.min, ref.offsetWithinRun);
      seen.max = Math.max(seen.max, ref.offsetWithinRun);
    }
  }

  const indices = [...bounds.keys()].sort((a, b) => a - b);
  const first = indices[0];
  const last = indices[indices.length - 1];

  const covered: Element[] = [];
  for (let index = first; index <= last; index++) {
    const run = part.runs[index];
    if (!run) continue;

    const length = runText(run).length;
    const bound = bounds.get(index);
    const from = index === first && bound ? bound.min : 0;
    const to = index === last && bound ? bound.max + 1 : length;

    if (from <= 0 && to >= length) {
      covered.push(run);
      continue;
    }
    const { before, middle, after } = splitRun(run, from, to);
    replaceRun(run, [before, middle, after]);
    covered.push(middle);
  }
  return covered;
}
