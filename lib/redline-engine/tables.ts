import type { WalkResult } from "../docx";
import type { RevisionIds } from "./ids";
import { childElements, revisionElement, siblingGroups, toDeletedText } from "./revise";
import { runsForSpan } from "./runs";
import type { LocatedSpan } from "./types";

/**
 * Replacing a table (the user's decision of 2026-09-07).
 *
 * A change confined to one cell is an ordinary in-place edit. A change spanning
 * cells cannot be: splicing across a cell boundary merges cells and leaves the
 * row short of its declared grid, which is the corruption Stage 0 measured. So
 * the original table is struck and an edited copy inserted after it.
 *
 * **The copy is cloned from the original, never rebuilt.** Cloning carries
 * `tblPr`, `tblGrid`, `tcPr`, borders, shading, column widths and merged cells
 * across for free; reconstructing them means the replacement looks subtly
 * different from the table it replaces, and nobody notices until a hotel opens
 * the file.
 *
 * Rows carry their own markers in `trPr` — `w:del` on the struck table's rows,
 * `w:ins` on the copy's — because without them Word renders the table wrongly.
 * Same class of omission as the paragraph-mark bug Stage 0 found.
 */

const ancestorOf = (node: Element, name: string): Element | null => {
  let current: Node | null = node.parentNode;
  while (current && current.nodeType === 1) {
    if ((current as Element).nodeName === name) return current as Element;
    current = current.parentNode;
  }
  return null;
};

/** Element children of `root`, deep, matching a tag. */
function descendants(root: Element, name: string): Element[] {
  const nodes = root.getElementsByTagName(name);
  const out: Element[] = [];
  for (let i = 0; i < nodes.length; i++) out.push(nodes[i]);
  return out;
}

/** Child-element indices from an ancestor down to a node, so the same spot can be found in a copy. */
function pathTo(ancestor: Element, node: Element): number[] {
  const path: number[] = [];
  let current: Element = node;
  while (current !== ancestor) {
    const parent = current.parentNode as Element | null;
    if (!parent) return [];
    path.unshift(childElements(parent).indexOf(current));
    current = parent;
  }
  return path;
}

function resolvePath(ancestor: Element, path: number[]): Element | null {
  let current: Element = ancestor;
  for (const index of path) {
    const next = childElements(current)[index];
    if (!next) return null;
    current = next;
  }
  return current;
}

/** Groups runs by the cell they sit in, keeping document order. */
function byCell(runs: Element[]): { cell: Element; runs: Element[] }[] {
  const groups: { cell: Element; runs: Element[] }[] = [];
  for (const run of runs) {
    const cell = ancestorOf(run, "w:tc");
    if (!cell) continue;
    const last = groups[groups.length - 1];
    if (last && last.cell === cell) last.runs.push(run);
    else groups.push({ cell, runs: [run] });
  }
  return groups;
}

function setRowMark(row: Element, tagName: "w:ins" | "w:del", ids: RevisionIds, author: string, date: string) {
  const doc = row.ownerDocument!;
  let trPr = childElements(row).find((c) => c.nodeName === "w:trPr");
  if (!trPr) {
    trPr = doc.createElement("w:trPr");
    // trPr is the first child of a row in the schema.
    row.insertBefore(trPr, row.firstChild);
  }
  trPr.appendChild(revisionElement(doc, tagName, ids, author, date));
}

function setParagraphMark(p: Element, tagName: "w:ins" | "w:del", ids: RevisionIds, author: string, date: string) {
  const doc = p.ownerDocument!;
  let pPr = childElements(p).find((c) => c.nodeName === "w:pPr");
  if (!pPr) {
    pPr = doc.createElement("w:pPr");
    p.insertBefore(pPr, p.firstChild);
  }
  let rPr = childElements(pPr).find((c) => c.nodeName === "w:rPr");
  if (!rPr) {
    rPr = doc.createElement("w:rPr");
    pPr.appendChild(rPr); // rPr is the last child of pPr in the schema
  }
  rPr.insertBefore(revisionElement(doc, tagName, ids, author, date), rPr.firstChild);
}

/**
 * Marks every row, paragraph and run of a table as added or struck.
 *
 * Runs already inside a deletion are left alone: that is the counterparty's own
 * struck text, which belongs to their revision history, not ours.
 */
function markWholeTable(
  table: Element,
  tagName: "w:ins" | "w:del",
  ids: RevisionIds,
  author: string,
  date: string
) {
  const doc = table.ownerDocument!;

  const runs = descendants(table, "w:r").filter(
    (run) => !ancestorOf(run, "w:del") && !ancestorOf(run, "w:moveFrom")
  );
  for (const group of siblingGroups(runs)) {
    const parent = group[0].parentNode!;
    const wrapper = revisionElement(doc, tagName, ids, author, date);
    parent.insertBefore(wrapper, group[0]);
    for (const run of group) {
      parent.removeChild(run);
      if (tagName === "w:del") toDeletedText(run);
      wrapper.appendChild(run);
    }
  }

  for (const p of descendants(table, "w:p")) setParagraphMark(p, tagName, ids, author, date);
  for (const row of childElements(table).filter((c) => c.nodeName === "w:tr")) {
    setRowMark(row, tagName, ids, author, date);
  }
}

/** An empty paragraph, marked as inserted, to keep two tables from merging into one. */
function separatorParagraph(doc: Document, ids: RevisionIds, author: string, date: string): Element {
  const p = doc.createElement("w:p");
  setParagraphMark(p, "w:ins", ids, author, date);
  return p;
}

export type TableReplacementResult = { ok: true } | { ok: false; reason: string };

/**
 * Strikes the table the span sits in and inserts an edited copy after it.
 *
 * The replacement wording arrives flattened the way the model produced it, with
 * cells joined by pipes, so it is split back out across the cells the span
 * covered. If the pieces do not match the cells, the finding is refused rather
 * than guessed at — a table with wording in the wrong column is worse than one
 * the associate has to raise by hand.
 */
export function replaceTable({
  part,
  span,
  replacement,
  author,
  date,
  ids,
}: {
  part: WalkResult;
  span: LocatedSpan;
  replacement: string;
  author: string;
  date: string;
  ids: RevisionIds;
}): TableReplacementResult {
  const covered = runsForSpan(part, span);
  if (covered.length === 0) return { ok: false, reason: "The wording resolved to no editable runs." };

  const table = ancestorOf(covered[0], "w:tbl");
  if (!table) return { ok: false, reason: "The wording is not inside a table after all." };

  const groups = byCell(covered);
  const pieces = replacement.split("|").map((s) => s.trim());
  if (pieces.length !== groups.length) {
    return {
      ok: false,
      reason:
        `The change covers ${groups.length} cells but the proposed wording has ${pieces.length} ` +
        `part${pieces.length === 1 ? "" : "s"}, so it cannot be laid back out across the row.`,
    };
  }

  const doc = table.ownerDocument!;
  const paths = groups.map((g) => g.runs.map((run) => pathTo(table, run)));

  const copy = table.cloneNode(true) as Element;

  // Put the new wording into the copy, cell by cell, before anything is marked.
  groups.forEach((group, index) => {
    const runsInCopy = paths[index].map((p) => resolvePath(copy, p)).filter((el): el is Element => el !== null);
    if (runsInCopy.length === 0) return;

    const first = runsInCopy[0];
    const rPr = childElements(first).find((c) => c.nodeName === "w:rPr");
    const run = doc.createElement("w:r");
    if (rPr) run.appendChild(rPr.cloneNode(true));
    const t = doc.createElement("w:t");
    t.setAttribute("xml:space", "preserve");
    t.appendChild(doc.createTextNode(pieces[index]));
    run.appendChild(t);

    first.parentNode!.insertBefore(run, first);
    for (const stale of runsInCopy) stale.parentNode?.removeChild(stale);
  });

  markWholeTable(table, "w:del", ids, author, date);
  markWholeTable(copy, "w:ins", ids, author, date);

  // Word merges two tables that sit next to each other, so they are kept apart.
  const parent = table.parentNode!;
  const separator = separatorParagraph(doc, ids, author, date);
  parent.insertBefore(separator, table.nextSibling);
  parent.insertBefore(copy, separator.nextSibling);

  return { ok: true };
}
