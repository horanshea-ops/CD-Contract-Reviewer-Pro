import type { RevisionIds } from "./ids";

/**
 * Emitting a tracked change (MASTER_PLAN.md §1.5.5–§1.5.7).
 *
 * The runs a span covers are wrapped in a `w:del`, their text converted to
 * `w:delText`, and the replacement follows in a `w:ins` whose run clones the
 * formatting of the first deleted run.
 *
 * §1.5.7's nested case falls out of doing this on the tree rather than on a
 * string. When the wording being struck is text the counterparty inserted, the
 * runs already sit inside their `w:ins`, so wrapping them in place puts our
 * deletion inside their insertion — which is what Word writes, renders
 * correctly, and is the case most likely to produce a corrupt file when it is
 * built by splicing text.
 */

const childElements = (node: Element): Element[] => {
  const out: Element[] = [];
  for (let i = 0; i < node.childNodes.length; i++) {
    const c = node.childNodes[i];
    if (c.nodeType === 1) out.push(c as Element);
  }
  return out;
};

/** Runs that sit next to each other under the same parent, so one wrapper can hold them. */
function siblingGroups(runs: Element[]): Element[][] {
  const groups: Element[][] = [];
  for (const run of runs) {
    const last = groups[groups.length - 1];
    const previous = last?.[last.length - 1];
    if (previous && previous.parentNode === run.parentNode && previous.nextSibling === run) last.push(run);
    else groups.push([run]);
  }
  return groups;
}

function revisionElement(doc: Document, tagName: string, ids: RevisionIds, author: string, date: string): Element {
  const el = doc.createElement(tagName);
  el.setAttribute("w:id", String(ids.take()));
  el.setAttribute("w:author", author);
  el.setAttribute("w:date", date);
  return el;
}

/** Deleted text lives in `w:delText`, or it reappears when the change is rejected. */
function toDeletedText(run: Element) {
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

/**
 * Strikes the covered runs and inserts the replacement immediately after.
 *
 * The covered runs can sit under different parents — part inside a hyperlink
 * and part outside, say — so each run of adjacent siblings gets its own
 * wrapper. One wrapper spanning two parents is not something XML can express,
 * and reaching for it is how the old engine produced files Word would not open.
 */
export function replaceSpan({ covered, replacement, author, date, ids }: ReplaceOptions): void {
  if (covered.length === 0) return;
  const doc = covered[0].ownerDocument!;
  const formatLike = covered[0];

  let lastDeletion: Element | null = null;
  for (const group of siblingGroups(covered)) {
    const parent = group[0].parentNode!;
    const deletion = revisionElement(doc, "w:del", ids, author, date);
    parent.insertBefore(deletion, group[0]);
    for (const run of group) {
      parent.removeChild(run);
      toDeletedText(run);
      deletion.appendChild(run);
    }
    lastDeletion = deletion;
  }

  if (!replacement) return;
  const insertion = revisionElement(doc, "w:ins", ids, author, date);
  insertion.appendChild(insertedRun(doc, replacement, formatLike));
  // Directly after the deletion, so the new wording reads where the old one
  // was. Inside the counterparty's insertion when that is where the old
  // wording lived, which keeps the position exact.
  const anchor = lastDeletion!;
  anchor.parentNode!.insertBefore(insertion, anchor.nextSibling);
}
