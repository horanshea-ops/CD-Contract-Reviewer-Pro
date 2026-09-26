import { loadDocx } from "./docx";
import { serializePart } from "./redline-engine/serialize";

/**
 * Accepts the tracked changes one export wrote, leaving the rest of the file as
 * it was. The result is the proposed contract in the property's own Word
 * formatting, with no revision marks of ours left in it.
 *
 * Revisions the property sent stay as tracked changes, so accepting CD's
 * changes never accepts theirs on CD's behalf.
 *
 * The engine writes four kinds of mark, and each is accepted differently:
 *
 *   w:ins / w:del around runs    unwrap the insertion, remove the deletion
 *   w:ins on a paragraph mark    remove the marker, keep the paragraph
 *   w:del on a paragraph mark    merge the paragraph into the next one
 *   w:ins / w:del on a table row remove the marker, or remove the row
 *
 * A table left with no rows is removed, and so is a paragraph left empty by
 * the merge.
 */

const REVISION = new Set(["w:ins", "w:del", "w:moveFrom", "w:moveTo"]);
const REMOVES = new Set(["w:del", "w:moveFrom"]);

const elements = (doc: Document, tag: string): Element[] => {
  const nodes = doc.getElementsByTagName(tag);
  const out: Element[] = [];
  for (let i = 0; i < nodes.length; i++) out.push(nodes[i]);
  return out;
};

const childElements = (el: Element): Element[] => {
  const out: Element[] = [];
  for (let i = 0; i < el.childNodes.length; i++) {
    const c = el.childNodes[i];
    if (c.nodeType === 1) out.push(c as Element);
  }
  return out;
};

const parentName = (el: Element) => (el.parentNode as Element | null)?.nodeName ?? "";

function ancestor(el: Element, name: string): Element | null {
  let node = el.parentNode;
  while (node && node.nodeType === 1) {
    if ((node as Element).nodeName === name) return node as Element;
    node = node.parentNode;
  }
  return null;
}

function unwrap(el: Element) {
  const parent = el.parentNode!;
  while (el.firstChild) parent.insertBefore(el.firstChild, el);
  parent.removeChild(el);
}

function remove(el: Element) {
  el.parentNode?.removeChild(el);
}

/** A paragraph's content: everything except its properties. */
const contentOf = (p: Element) => childElements(p).filter((c) => c.nodeName !== "w:pPr");

/** Merges a paragraph whose mark we deleted into the paragraph after it, as Word does on accept. */
function mergeIntoNext(p: Element) {
  let next = p.nextSibling;
  while (next && next.nodeType !== 1) next = next.nextSibling;
  const nextP = next as Element | null;
  if (!nextP || nextP.nodeName !== "w:p") {
    // Nothing to merge into, as at the end of a cell. The paragraph stays.
    return;
  }
  const content = contentOf(p);
  const anchor = childElements(nextP).find((c) => c.nodeName !== "w:pPr") ?? null;
  for (const c of content) nextP.insertBefore(c, anchor);
  remove(p);
}

export function acceptOwnRevisionsInDoc(doc: Document, ownIds: ReadonlySet<string>) {
  const ours = (el: Element) => ownIds.has(el.getAttribute("w:id") ?? "");

  const marks = [...REVISION].flatMap((tag) => elements(doc, tag)).filter(ours);
  const rowMarks = marks.filter((m) => parentName(m) === "w:trPr");
  const paragraphMarks = marks.filter((m) => parentName(m) === "w:rPr" && ancestor(m, "w:pPr"));
  const contentMarks = marks.filter((m) => !rowMarks.includes(m) && !paragraphMarks.includes(m));

  for (const m of rowMarks) {
    const row = ancestor(m, "w:tr");
    if (REMOVES.has(m.nodeName) && row) remove(row);
    else remove(m);
  }

  // Innermost first, so a deletion inside an insertion is resolved before its wrapper is unwrapped.
  for (const m of contentMarks.reverse()) {
    if (!m.parentNode) continue;
    if (REMOVES.has(m.nodeName)) remove(m);
    else unwrap(m);
  }

  for (const m of paragraphMarks) {
    const p = ancestor(m, "w:p");
    const deleted = REMOVES.has(m.nodeName);
    const rPr = m.parentNode as Element;
    remove(m);
    if (!childElements(rPr).length) remove(rPr);
    if (deleted && p?.parentNode) mergeIntoNext(p);
  }

  for (const table of elements(doc, "w:tbl")) {
    if (!childElements(table).some((c) => c.nodeName === "w:tr")) remove(table);
  }
}

export async function acceptOwnRevisions(docxBytes: Uint8Array, ownIds: ReadonlySet<string>): Promise<Uint8Array> {
  const pkg = await loadDocx(docxBytes);
  for (const part of pkg.textParts) {
    acceptOwnRevisionsInDoc(part.doc, ownIds);
    pkg.zip.file(part.path, serializePart(part));
  }
  return pkg.zip.generateAsync({ type: "uint8array" });
}
