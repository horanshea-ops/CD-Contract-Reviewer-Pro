import { loadDocx } from "./docx";
import { stripComments } from "./redline-engine/comments";
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
 *   w:del on a paragraph mark    join the next paragraph onto this one
 *   w:ins / w:del on a table row remove the marker, or remove the row
 *
 * A joined paragraph keeps the first one's formatting, as Word does on accept
 * (checked in Word for the web, 2026-10-09). A table left with no rows is
 * removed.
 *
 * The export's own comments go too. They explain changes that, once accepted,
 * no longer show. The property's comments stay.
 */

const REVISION = new Set(["w:ins", "w:del", "w:moveFrom", "w:moveTo"]);
const REMOVES = new Set(["w:del", "w:moveFrom"]);

const elements = (root: Document | Element, tag: string): Element[] => {
  const nodes = root.getElementsByTagName(tag);
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

/**
 * Joins onto each paragraph whose mark was deleted the paragraph after it,
 * and the one after that while the marks keep being deleted ones. The first
 * paragraph of a chain keeps its formatting.
 */
function joinFollowing(deleted: Set<Element>) {
  for (const p of [...deleted]) {
    // Already joined onto an earlier paragraph of its chain.
    if (!p.parentNode) continue;

    for (;;) {
      let next = p.nextSibling;
      while (next && next.nodeType !== 1) next = next.nextSibling;
      const nextP = next as Element | null;
      // Nothing to join, as at the end of a cell. The paragraph stays.
      if (!nextP || nextP.nodeName !== "w:p") break;

      for (const c of contentOf(nextP)) p.appendChild(c);
      remove(nextP);
      // A paragraph whose own mark stays ends the chain.
      if (!deleted.has(nextP)) break;
    }
    deleted.delete(p);
  }
}

export function acceptOwnRevisionsInDoc(doc: Document, ownIds: ReadonlySet<string>) {
  acceptRevisionsIn(doc, (mark) => ownIds.has(mark.getAttribute("w:id") ?? ""));
}

/**
 * Accepts the tracked changes inside `root` that `accepts` picks out, the four
 * kinds listed above. The engine uses it on a table's copy, with every change
 * picked, so the copy reads as the table does and carries nobody's marks.
 */
export function acceptRevisionsIn(root: Document | Element, accepts: (mark: Element) => boolean) {
  const marks = [...REVISION].flatMap((tag) => elements(root, tag)).filter(accepts);
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

  const deletedMarks = new Set<Element>();
  for (const m of paragraphMarks) {
    const p = ancestor(m, "w:p");
    const rPr = m.parentNode as Element;
    if (REMOVES.has(m.nodeName) && p) deletedMarks.add(p);
    remove(m);
    if (!childElements(rPr).length) remove(rPr);
  }
  joinFollowing(deletedMarks);

  for (const table of elements(root, "w:tbl")) {
    if (!childElements(table).some((c) => c.nodeName === "w:tr")) remove(table);
  }
}

export async function acceptOwnRevisions(
  docxBytes: Uint8Array,
  ownIds: ReadonlySet<string>,
  ownComments: { ids: ReadonlySet<string>; createdPart: boolean } = { ids: new Set(), createdPart: false }
): Promise<Uint8Array> {
  const pkg = await loadDocx(docxBytes);
  for (const part of pkg.textParts) acceptOwnRevisionsInDoc(part.doc, ownIds);
  await stripComments({
    zip: pkg.zip,
    parts: pkg.textParts,
    ownCommentIds: ownComments.ids,
    createdCommentsPart: ownComments.createdPart,
  });
  for (const part of pkg.textParts) pkg.zip.file(part.path, serializePart(part));
  return pkg.zip.generateAsync({ type: "uint8array" });
}
