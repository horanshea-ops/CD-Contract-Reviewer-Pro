import type { RevisionIds } from "./ids";
import { replaceRun, runText, splitRun } from "./runs";
import { wordChanges, type WordChange } from "./word-diff";

/**
 * Emitting a tracked change (MASTER_PLAN.md §1.5.5–§1.5.7).
 *
 * Only the words that change are marked. Each changed stretch becomes a `w:ins`
 * holding the new wording, followed by a `w:del` holding the old, and the words
 * the proposal shares with the contract stay as they were. The inserted run
 * clones the formatting of the first deleted run.
 *
 * §1.5.7's nested case falls out of doing this on the tree rather than on a
 * string. When the wording being struck is text the counterparty inserted, the
 * runs already sit inside their `w:ins`, so wrapping them in place puts our
 * deletion inside their insertion — which is what Word writes, renders
 * correctly, and is the case most likely to produce a corrupt file when it is
 * built by splicing text.
 */

export const childElements = (node: Element): Element[] => {
  const out: Element[] = [];
  for (let i = 0; i < node.childNodes.length; i++) {
    const c = node.childNodes[i];
    if (c.nodeType === 1) out.push(c as Element);
  }
  return out;
};

/** Runs that sit next to each other under the same parent, so one wrapper can hold them. */
export function siblingGroups(runs: Element[]): Element[][] {
  const groups: Element[][] = [];
  for (const run of runs) {
    const last = groups[groups.length - 1];
    const previous = last?.[last.length - 1];
    if (previous && previous.parentNode === run.parentNode && previous.nextSibling === run) last.push(run);
    else groups.push([run]);
  }
  return groups;
}

export function revisionElement(doc: Document, tagName: string, ids: RevisionIds, author: string, date: string): Element {
  const el = doc.createElement(tagName);
  el.setAttribute("w:id", String(ids.take()));
  el.setAttribute("w:author", author);
  el.setAttribute("w:date", date);
  return el;
}

/** Deleted text lives in `w:delText`, or it reappears when the change is rejected. */
export function toDeletedText(run: Element) {
  const doc = run.ownerDocument!;
  for (const child of childElements(run)) {
    if (child.nodeName !== "w:t") continue;
    const replacement = doc.createElement("w:delText");
    const attrs = child.attributes;
    for (let i = 0; i < attrs.length; i++) replacement.setAttribute(attrs[i].name, attrs[i].value);
    replacement.setAttribute("xml:space", "preserve");
    replacement.appendChild(doc.createTextNode(child.textContent ?? ""));
    run.replaceChild(replacement, child);
  }
}

/** A run carrying the replacement wording, formatted like the wording it replaces. */
function insertedRun(doc: Document, text: string, formatLike: Element | null): Element {
  const run = doc.createElement("w:r");
  const rPr = formatLike ? childElements(formatLike).find((c) => c.nodeName === "w:rPr") : null;
  if (rPr) run.appendChild(rPr.cloneNode(true));
  const t = doc.createElement("w:t");
  t.setAttribute("xml:space", "preserve");
  t.appendChild(doc.createTextNode(text));
  run.appendChild(t);
  return run;
}

export interface ReplaceOptions {
  covered: Element[];
  replacement: string;
  author: string;
  date: string;
  ids: RevisionIds;
}

type Stamp = Pick<ReplaceOptions, "author" | "date" | "ids">;

/**
 * Replaces the covered runs with the replacement as tracked changes.
 *
 * Marking only the changed words needs every covered run to be plain text that
 * still reads in the contract. Anything else (a tab, a field, wording someone
 * already struck) takes one change over the whole passage instead, as does a
 * proposal that rewrites most of it.
 */
export function replaceSpan({ covered, replacement, ...stamp }: ReplaceOptions): void {
  if (covered.length === 0) return;

  if (covered.every(isPlainLiveText)) {
    const passage = covered.map(runText).join("");
    const changes = wordChanges(passage, replacement);
    const whole = changes.length === 1 && changes[0].from === 0 && changes[0].to === passage.length;
    if (!whole) {
      applyWordChanges(covered, changes, stamp);
      return;
    }
  }

  strikeAndInsert(covered, replacement, stamp);
}

/**
 * Inserts the replacement, then strikes the covered runs after it.
 *
 * New wording comes first because Word's margin note for a deletion runs on
 * into an insertion that follows it, with no break between the two.
 *
 * The covered runs can sit under different parents — part inside a hyperlink
 * and part outside, say — so each run of adjacent siblings gets its own
 * wrapper. One wrapper spanning two parents is not something XML can express,
 * and reaching for it is how the old engine produced files Word would not open.
 */
function strikeAndInsert(covered: Element[], replacement: string, { author, date, ids }: Stamp) {
  const doc = covered[0].ownerDocument!;
  const formatLike = covered[0];

  const deletions: Element[] = [];
  for (const group of siblingGroups(covered)) {
    const parent = group[0].parentNode!;
    const deletion = revisionElement(doc, "w:del", ids, author, date);
    parent.insertBefore(deletion, group[0]);
    for (const run of group) {
      parent.removeChild(run);
      toDeletedText(run);
      deletion.appendChild(run);
    }
    deletions.push(deletion);
  }

  if (!replacement) return;
  const insertion = revisionElement(doc, "w:ins", ids, author, date);
  insertion.appendChild(insertedRun(doc, replacement, formatLike));

  // Directly before the deletion, so the new wording reads where the old one
  // was. Inside the counterparty's insertion when that is where the old
  // wording lived, which keeps the position exact.
  deletions[0].parentNode!.insertBefore(insertion, deletions[0]);
}

/** A run of ordinary text, not inside anyone's deletion. */
function isPlainLiveText(run: Element): boolean {
  if (!childElements(run).every((c) => c.nodeName === "w:rPr" || c.nodeName === "w:t")) return false;
  for (let node = run.parentNode; node && node.nodeType === 1; node = node.parentNode) {
    const name = (node as Element).nodeName;
    if (name === "w:del" || name === "w:moveFrom") return false;
  }
  return true;
}

/** Where each run starts in the passage, and where it ends. */
function extents(pieces: Element[]): { run: Element; start: number; end: number }[] {
  let start = 0;
  return pieces.map((run) => {
    const end = start + runText(run).length;
    const out = { run, start, end };
    start = end;
    return out;
  });
}

/** Splits the run that `offset` falls inside, so a run boundary sits there. */
function cutAt(pieces: Element[], offset: number): Element[] {
  const hit = extents(pieces).findIndex(({ start, end }) => start < offset && offset < end);
  if (hit === -1) return pieces;

  const { run, start, end } = extents(pieces)[hit];
  const { before, middle } = splitRun(run, offset - start, end - start);
  replaceRun(run, [before, middle]);
  return [...pieces.slice(0, hit), before!, middle, ...pieces.slice(hit + 1)];
}

/**
 * Makes each change as its own tracked change, last first.
 *
 * Working from the end keeps every earlier offset valid. Struck runs keep
 * their text as `w:delText`, which `runText` still counts.
 */
function applyWordChanges(covered: Element[], changes: WordChange[], stamp: Stamp) {
  let pieces = covered;
  for (const change of [...changes].reverse()) {
    pieces = cutAt(pieces, change.to);
    pieces = cutAt(pieces, change.from);
    const struck = extents(pieces)
      .filter(({ start, end }) => start < end && change.from <= start && end <= change.to)
      .map(({ run }) => run);

    if (struck.length) strikeAndInsert(struck, change.text, stamp);
    else insertAt(pieces, change.from, change.text, stamp);
  }
}

/** A pure insertion, after the word it follows or before the passage's first. */
function insertAt(pieces: Element[], offset: number, text: string, { author, date, ids }: Stamp) {
  if (!text) return;
  const withText = extents(pieces).filter(({ start, end }) => start < end);
  const previous = withText.find(({ end }) => end === offset)?.run ?? null;
  const next = previous ? null : withText[0].run;

  const doc = pieces[0].ownerDocument!;
  const insertion = revisionElement(doc, "w:ins", ids, author, date);
  insertion.appendChild(insertedRun(doc, text, previous ?? next));
  if (previous) previous.parentNode!.insertBefore(insertion, previous.nextSibling);
  else next!.parentNode!.insertBefore(insertion, next);
}
