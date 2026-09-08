import type { ParsedPart } from "../docx";
import type { RevisionIds } from "./ids";

/**
 * Adding a clause the contract does not have (MASTER_PLAN.md §1.5.8).
 *
 * A new paragraph needs the insertion marked in two places: on its runs, and on
 * the paragraph mark itself in `pPr/rPr`. Without the second one, rejecting
 * every change removes the words and leaves a blank paragraph behind in the
 * property's contract — Stage 0 found exactly that, and §1.6 now fails an
 * export for it.
 *
 * **Nothing internal goes in here.** The old engine labelled each item with its
 * severity ("HIGH — ATTRITION"), which tells the property how much CD cares
 * about a term before the negotiation starts. It also appended a second list,
 * headed "COULD NOT BE LOCATED FOR MARKUP", of findings the engine had failed
 * on. Both are gone: the appendix carries the proposed contract language and
 * nothing else, and what could not be applied is shown to the associate before
 * download instead (CLAUDE.md deviation 6, §1.6.4).
 */

const HEADING = "Additional Provisions";

const childElements = (node: Element): Element[] => {
  const out: Element[] = [];
  for (let i = 0; i < node.childNodes.length; i++) {
    const c = node.childNodes[i];
    if (c.nodeType === 1) out.push(c as Element);
  }
  return out;
};

const firstChild = (node: Element, name: string): Element | null =>
  childElements(node).find((c) => c.nodeName === name) ?? null;

/**
 * Paragraph properties for an appended clause.
 *
 * Style is copied from the last paragraph of the contract so the new text is
 * set in the same face as the rest of it. Numbering is not: continuing whatever
 * list happened to end the document would number a standalone appendix into it.
 */
function appendixProperties(doc: Document, model: Element | null): Element {
  const source = model ? firstChild(model, "w:pPr") : null;
  const pPr = source ? (source.cloneNode(true) as Element) : doc.createElement("w:pPr");
  for (const child of childElements(pPr)) {
    if (child.nodeName === "w:numPr" || child.nodeName === "w:rPr") pPr.removeChild(child);
  }
  return pPr;
}

/** Marks the paragraph mark itself as inserted. */
function markParagraphInserted(doc: Document, pPr: Element, ids: RevisionIds, author: string, date: string) {
  const rPr = doc.createElement("w:rPr");
  const ins = doc.createElement("w:ins");
  ins.setAttribute("w:id", String(ids.take()));
  ins.setAttribute("w:author", author);
  ins.setAttribute("w:date", date);
  rPr.appendChild(ins);
  // rPr is the last element of pPr in the schema.
  pPr.appendChild(rPr);
}

function insertedParagraph(
  doc: Document,
  text: string,
  model: Element | null,
  ids: RevisionIds,
  author: string,
  date: string,
  bold = false
): Element {
  const p = doc.createElement("w:p");
  const pPr = appendixProperties(doc, model);
  markParagraphInserted(doc, pPr, ids, author, date);
  p.appendChild(pPr);

  const ins = doc.createElement("w:ins");
  ins.setAttribute("w:id", String(ids.take()));
  ins.setAttribute("w:author", author);
  ins.setAttribute("w:date", date);

  const run = doc.createElement("w:r");
  if (bold) {
    const rPr = doc.createElement("w:rPr");
    rPr.appendChild(doc.createElement("w:b"));
    run.appendChild(rPr);
  }
  const t = doc.createElement("w:t");
  t.setAttribute("xml:space", "preserve");
  t.appendChild(doc.createTextNode(text));
  run.appendChild(t);

  ins.appendChild(run);
  p.appendChild(ins);
  return p;
}

/**
 * Appends the proposed clauses to the end of the body, as tracked insertions.
 *
 * Placed before `w:sectPr`, which carries the section's page setup and must
 * stay the last child of the body.
 */
export function appendClauses({
  part,
  clauses,
  author,
  date,
  ids,
}: {
  part: ParsedPart;
  clauses: string[];
  author: string;
  date: string;
  ids: RevisionIds;
}): void {
  if (clauses.length === 0) return;

  const doc = part.doc;
  const body = doc.getElementsByTagName("w:body")[0];
  if (!body) return;

  const paragraphs = childElements(body).filter((c) => c.nodeName === "w:p");
  const model = paragraphs[paragraphs.length - 1] ?? null;
  const sectPr = childElements(body).find((c) => c.nodeName === "w:sectPr") ?? null;

  const add = (el: Element) => {
    if (sectPr) body.insertBefore(el, sectPr);
    else body.appendChild(el);
  };

  add(insertedParagraph(doc, HEADING, model, ids, author, date, true));
  for (const clause of clauses) add(insertedParagraph(doc, clause, model, ids, author, date));
}
