import type { WalkResult } from "../docx";
import type { UnappliedReason } from "../redline-validation/types";
import type { RevisionIds } from "./ids";
import { acceptRevisionsIn } from "../docx-accept";
import { refsInSpan } from "./applicability";
import { childElements, insertedRun, revisionElement, setParagraphMark, siblingGroups, toDeletedText } from "./revise";
import { runText, runsForSpan } from "./runs";
import { rowCells, splitAcrossCells } from "./cell-split";
import type { LocatedSpan } from "./types";

/**
 * Replacing a table: the original is struck and an edited copy inserted after it.
 *
 * This is the fallback (the user's decision of 2026-10-08). A change spanning
 * cells is first made cell by cell, in place, and the table is replaced only
 * when the change can't be placed that way.
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

/**
 * True when anything in the table still records a tracked change. Every such
 * record names its author, whatever kind it is: a formatting change, a moved
 * passage, a merged cell.
 */
function holdsTrackedChange(table: Element): boolean {
  return descendants(table, "*").some((el) => el.hasAttribute("w:author"));
}

const COMMENT_MARKERS = ["w:commentRangeStart", "w:commentRangeEnd", "w:commentReference"];

/**
 * True when a comment is anchored inside the table. A copy would repeat the
 * comment's markers, and the struck original would take the comment with it
 * when our change is accepted.
 */
function holdsComment(table: Element): boolean {
  return COMMENT_MARKERS.some((name) => table.getElementsByTagName(name).length > 0);
}

/** An empty paragraph, marked as inserted, to keep two tables from merging into one. */
function separatorParagraph(doc: Document, ids: RevisionIds, author: string, date: string): Element {
  const p = doc.createElement("w:p");
  setParagraphMark(p, "w:ins", ids, author, date);
  return p;
}

/**
 * The wording for each covered cell. A proposal with "|" is split on it; one
 * without is laid out by comparing it with the cells, or null when that can't
 * be done without guessing.
 */
function cellPieces(replacement: string, cells: string[]): string[] | null {
  if (replacement.includes("|") || cells.length < 2) return rowCells(replacement);
  return splitAcrossCells(cells, replacement);
}

export type TableReplacementResult =
  | { ok: true }
  | { ok: false; reason: string; unapplied?: UnappliedReason };

/**
 * The wording for each covered cell, or why it can't be laid out across them.
 * `cells` is the wording each cell holds today.
 */
export function layOut(replacement: string, cells: string[]): { pieces: string[] } | { reason: string } {
  const pieces = cellPieces(replacement, cells);
  if (!pieces) {
    return {
      reason:
        `The change covers ${cells.length} cells, and the proposed wording can't be laid out across them ` +
        `without guessing which cell a change belongs to.`,
    };
  }
  if (pieces.length !== cells.length) {
    return {
      reason:
        `The change covers ${cells.length} cells but the proposed wording has ${pieces.length} ` +
        `part${pieces.length === 1 ? "" : "s"}, so it cannot be laid back out across the row.`,
    };
  }
  return { pieces };
}

const wordingOf = (groups: { runs: Element[] }[]) => groups.map((g) => g.runs.map(runText).join(""));

/**
 * The copy of a table this export has already inserted, when the span sits
 * inside one. Read from the walk, before any run is split.
 */
export function copyHolding(part: WalkResult, span: LocatedSpan, copies: ReadonlySet<Element>): Element | null {
  const ref = refsInSpan(part, span)[0];
  const run = ref ? part.runs[ref.runIndex] : null;
  for (let node = run?.parentNode; node && node.nodeType === 1; node = node.parentNode) {
    if (copies.has(node as Element)) return node as Element;
  }
  return null;
}

export type CopyEditResult = { ok: true; revisionIds: string[] } | { ok: false; reason: string };

/**
 * Changes wording inside a copy this export has already inserted.
 *
 * A second change to a replaced table must not strike the copy and insert
 * another, which repeats every change id the first copy carries. The copy is
 * our own insertion, so the new wording goes straight into it, inside the
 * insertion already there. No new tracked change is made.
 *
 * Returns the ids of the insertions that now hold the wording, for anchoring
 * the finding's comment.
 */
export function editCopy({
  part,
  span,
  replacement,
  ownIds,
}: {
  part: WalkResult;
  span: LocatedSpan;
  replacement: string;
  ownIds: ReadonlySet<string>;
}): CopyEditResult {
  const covered = runsForSpan(part, span);
  if (covered.length === 0) return { ok: false, reason: "The wording resolved to no editable runs." };

  const groups = byCell(covered);
  const laid = layOut(replacement, wordingOf(groups));
  if ("reason" in laid) return { ok: false, reason: laid.reason };

  // Checked for every run before anything changes, so a refusal leaves the copy as it was.
  const ourInsertion = (run: Element) => {
    const parent = run.parentNode as Element | null;
    return parent?.nodeName === "w:ins" && ownIds.has(parent.getAttribute("w:id") ?? "") ? parent : null;
  };
  if (groups.length === 0 || !covered.every(ourInsertion)) {
    return { ok: false, reason: "The wording sits in a replaced table, outside the wording this export inserted." };
  }

  const doc = covered[0].ownerDocument!;
  const revisionIds: string[] = [];

  groups.forEach((group, index) => {
    const first = group.runs[0];
    const holder = ourInsertion(first)!;
    holder.insertBefore(insertedRun(doc, laid.pieces[index], first), first);
    revisionIds.push(holder.getAttribute("w:id")!);

    for (const stale of group.runs) {
      const wrapper = stale.parentNode as Element;
      wrapper.removeChild(stale);
      if (childElements(wrapper).length === 0) wrapper.parentNode?.removeChild(wrapper);
    }
  });

  return { ok: true, revisionIds };
}

/**
 * Strikes the table the span sits in and inserts an edited copy after it.
 *
 * The replacement wording arrives flattened the way the model produced it, with
 * cells joined by pipes or with no separators at all, so it is split back out
 * across the cells the span covered. If the pieces do not match the cells, the
 * finding is refused rather than guessed at — a table with wording in the wrong
 * column is worse than one the associate has to raise by hand.
 */
export function replaceTable({
  part,
  span,
  replacement,
  author,
  date,
  ids,
  copies,
}: {
  part: WalkResult;
  span: LocatedSpan;
  replacement: string;
  author: string;
  date: string;
  ids: RevisionIds;
  /** Every copy this export has inserted. The new one is added. */
  copies: Set<Element>;
}): TableReplacementResult {
  const covered = runsForSpan(part, span);
  if (covered.length === 0) return { ok: false, reason: "The wording resolved to no editable runs." };

  const table = ancestorOf(covered[0], "w:tbl");
  if (!table) return { ok: false, reason: "The wording is not inside a table after all." };

  if (holdsComment(table)) {
    return {
      ok: false,
      unapplied: "table_holds_comment",
      reason:
        "The table holds a comment from the property, and the change can't be made one cell at a time. " +
        "Replacing the table would remove the comment, so the table is left as it is.",
    };
  }

  const groups = byCell(covered);
  const laid = layOut(replacement, wordingOf(groups));
  if ("reason" in laid) return { ok: false, reason: laid.reason };
  const { pieces } = laid;

  const doc = table.ownerDocument!;
  const paths = groups.map((g) => g.runs.map((run) => pathTo(table, run)));

  const copy = table.cloneNode(true) as Element;

  // Found before the copy's changes are accepted, since accepting moves runs out of their wrappers.
  const inCopy = paths.map((cell) => cell.map((p) => resolvePath(copy, p)).filter((el): el is Element => el !== null));

  // The copy reads as the table reads today and carries nobody's marks. A
  // cloned mark would repeat its id, and the original keeps every mark anyway.
  acceptRevisionsIn(copy, () => true);
  if (holdsTrackedChange(copy)) {
    return {
      ok: false,
      reason:
        "The table holds a tracked change the redline can't carry into its copy, such as a formatting change, " +
        "so the table is left as it is.",
    };
  }

  // Put the new wording into the copy, cell by cell, before anything is marked.
  groups.forEach((group, index) => {
    const runsInCopy = inCopy[index].filter((run) => copy.contains(run));
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
  copies.add(copy);

  return { ok: true };
}
