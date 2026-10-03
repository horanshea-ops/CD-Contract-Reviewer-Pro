import { XMLSerializer } from "@xmldom/xmldom";
import type JSZip from "jszip";
import { parseXml, type ParsedPart } from "../docx";

/**
 * Short "why" comments on our changes (MASTER_PLAN.md §1.5.11, CLAUDE.md
 * deviation 8).
 *
 * The file reaches the property, so the text written here comes only from the
 * map `lib/redline-comments/assembly.ts` builds. Nothing in this module reads a
 * finding.
 *
 * Each comment is three markers in the body and one entry in comments.xml:
 *
 *   commentRangeStart   before the first changed element in the paragraph
 *   commentRangeEnd     after the last one
 *   commentReference    in a run of its own, after the end marker
 *
 * The markers sit directly under the paragraph, outside every revision. A
 * reference inside someone's insertion would vanish if they rejected it and
 * leave the comment pointing at nothing.
 */

const W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const COMMENTS_REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments";
const COMMENTS_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml";
const RELS_NS = "http://schemas.openxmlformats.org/package/2006/relationships";
const DOC_RELS_PATH = "word/_rels/document.xml.rels";
const DEFAULT_COMMENTS_PATH = "word/comments.xml";

/** xmldom serializes its own node type, which is not the DOM lib's. */
type SerializableNode = Parameters<XMLSerializer["serializeToString"]>[0];
const serialize = (doc: Document) => new XMLSerializer().serializeToString(doc as unknown as SerializableNode);

const childElements = (node: Element): Element[] => {
  const out: Element[] = [];
  for (let i = 0; i < node.childNodes.length; i++) {
    const c = node.childNodes[i];
    if (c.nodeType === 1) out.push(c as Element);
  }
  return out;
};

const elements = (root: Document | Element, tag: string): Element[] => {
  const nodes = root.getElementsByTagName(tag);
  const out: Element[] = [];
  for (let i = 0; i < nodes.length; i++) out.push(nodes[i]);
  return out;
};

const ancestor = (el: Element, name: string): Element | null => {
  for (let node = el.parentNode; node && node.nodeType === 1; node = node.parentNode) {
    if ((node as Element).nodeName === name) return node as Element;
  }
  return null;
};

/** A revision around content, as opposed to one on a paragraph mark or a table row. */
function isContentRevision(el: Element): boolean {
  const parent = (el.parentNode as Element | null)?.nodeName;
  return parent !== "w:rPr" && parent !== "w:trPr";
}

/** The child of the paragraph that holds `el`. */
function topLevel(el: Element, p: Element): Element {
  let node: Element = el;
  while (node.parentNode && node.parentNode !== p) node = node.parentNode as Element;
  return node;
}

/** What to anchor one comment on, and what it says. */
export interface CommentAnchor {
  /** Content-level revision elements this finding wrote, in any order. */
  changes: Element[];
  text: string;
}

/**
 * The span one comment covers. New wording is preferred, so a replaced table is
 * annotated where it reads, not on the struck original. The span stays inside
 * one paragraph, which every non-table change already does.
 */
function anchorSpan(changes: Element[]): { p: Element; first: Element; last: Element } | null {
  const lead = changes.find((c) => c.nodeName === "w:ins") ?? changes[0];
  if (!lead) return null;
  const p = ancestor(lead, "w:p");
  if (!p) return null;
  // Document order, which is not id order: a replacement's deletion takes its id first but sits second.
  const inParagraph = revisionsIn(p).filter((c) => changes.includes(c));
  if (inParagraph.length === 0) return null;
  return { p, first: topLevel(inParagraph[0], p), last: topLevel(inParagraph[inParagraph.length - 1], p) };
}

/** Content-level revisions in a part, keyed by id. */
export function revisionsById(part: ParsedPart): Map<string, Element> {
  const out = new Map<string, Element>();
  for (const tag of ["w:ins", "w:del"]) {
    for (const el of elements(part.doc, tag)) {
      if (isContentRevision(el)) out.set(el.getAttribute("w:id") ?? "", el);
    }
  }
  return out;
}

/**
 * Content-level revisions inside one paragraph, in document order. Nested ones
 * count too, since ours can sit inside the property's insertion.
 */
export function revisionsIn(p: Element): Element[] {
  const out: Element[] = [];
  const walk = (el: Element) => {
    for (const c of childElements(el)) {
      if ((c.nodeName === "w:ins" || c.nodeName === "w:del") && isContentRevision(c)) out.push(c);
      walk(c);
    }
  };
  walk(p);
  return out;
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0]!.toUpperCase())
    .slice(0, 3)
    .join("");
}

function resolveTarget(target: string): string {
  if (target.startsWith("/")) return target.slice(1);
  return `word/${target.replace(/^\.\//, "")}`;
}

/**
 * Writes the comments into the package. The document part is edited in place
 * and serialized by the caller; comments.xml, the relationships and the content
 * types are written here.
 *
 * `firstId` must sit above every id the package already uses, revisions
 * included, so no comment shares an id with anything.
 */
export async function writeComments({
  zip,
  document,
  anchors,
  author,
  date,
  firstId,
}: {
  zip: JSZip;
  document: ParsedPart;
  anchors: CommentAnchor[];
  author: string;
  date: string;
  firstId: number;
}): Promise<{ ownCommentIds: string[]; createdCommentsPart: boolean }> {
  const placed = anchors
    .map((a) => ({ text: a.text.trim(), span: anchorSpan(a.changes) }))
    .filter((a): a is { text: string; span: NonNullable<ReturnType<typeof anchorSpan>> } => !!a.text && !!a.span);
  if (placed.length === 0) return { ownCommentIds: [], createdCommentsPart: false };

  const rels = await loadRels(zip);
  const existingRel = elements(rels, "Relationship").find((r) => r.getAttribute("Type") === COMMENTS_REL);
  const commentsPath = existingRel ? resolveTarget(existingRel.getAttribute("Target") ?? "") : DEFAULT_COMMENTS_PATH;
  const existingFile = zip.file(commentsPath);
  const created = !existingFile;

  const comments = existingFile
    ? parseXml(await existingFile.async("string"), commentsPath)
    : parseXml(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:comments xmlns:w="${W_NS}"/>`,
        commentsPath
      );
  const root = comments.documentElement!;

  // Above every comment already in the file as well as every id in the body.
  let next = firstId;
  for (const c of elements(comments, "w:comment")) {
    const n = Number(c.getAttribute("w:id"));
    if (Number.isFinite(n) && n >= next) next = n + 1;
  }

  const doc = document.doc;
  const ownCommentIds: string[] = [];
  for (const { text, span } of placed) {
    const id = String(next++);
    ownCommentIds.push(id);

    const start = doc.createElement("w:commentRangeStart");
    start.setAttribute("w:id", id);
    const end = doc.createElement("w:commentRangeEnd");
    end.setAttribute("w:id", id);
    const refRun = doc.createElement("w:r");
    const ref = doc.createElement("w:commentReference");
    ref.setAttribute("w:id", id);
    refRun.appendChild(ref);

    span.p.insertBefore(start, span.first);
    span.p.insertBefore(end, span.last.nextSibling);
    span.p.insertBefore(refRun, end.nextSibling);

    const comment = comments.createElement("w:comment");
    comment.setAttribute("w:id", id);
    comment.setAttribute("w:author", author);
    comment.setAttribute("w:date", date);
    comment.setAttribute("w:initials", initials(author));
    const p = comments.createElement("w:p");
    const r = comments.createElement("w:r");
    const t = comments.createElement("w:t");
    t.setAttribute("xml:space", "preserve");
    t.appendChild(comments.createTextNode(text));
    r.appendChild(t);
    p.appendChild(r);
    comment.appendChild(p);
    root.appendChild(comment);
  }

  zip.file(commentsPath, xmlWithProlog(serialize(comments)));

  if (created) {
    addRelationship(rels, commentsPath);
    zip.file(DOC_RELS_PATH, xmlWithProlog(serialize(rels)));
    await addContentType(zip, commentsPath);
  }

  return { ownCommentIds, createdCommentsPart: created };
}

const xmlWithProlog = (xml: string) =>
  xml.startsWith("<?xml") ? xml : `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n${xml}`;

async function loadRels(zip: JSZip): Promise<Document> {
  const file = zip.file(DOC_RELS_PATH);
  const xml = file
    ? await file.async("string")
    : `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="${RELS_NS}"/>`;
  return parseXml(xml, DOC_RELS_PATH);
}

function addRelationship(rels: Document, commentsPath: string) {
  const root = rels.documentElement!;
  const taken = new Set(elements(rels, "Relationship").map((r) => r.getAttribute("Id")));
  let n = taken.size + 1;
  while (taken.has(`rId${n}`)) n++;
  const rel = rels.createElementNS(RELS_NS, "Relationship");
  rel.setAttribute("Id", `rId${n}`);
  rel.setAttribute("Type", COMMENTS_REL);
  rel.setAttribute("Target", commentsPath.replace(/^word\//, ""));
  root.appendChild(rel);
}

async function addContentType(zip: JSZip, commentsPath: string) {
  const file = zip.file("[Content_Types].xml");
  if (!file) return;
  const types = parseXml(await file.async("string"), "[Content_Types].xml");
  const partName = `/${commentsPath}`;
  if (elements(types, "Override").some((o) => o.getAttribute("PartName") === partName)) return;
  const root = types.documentElement!;
  const override = types.createElementNS(root.namespaceURI, "Override");
  override.setAttribute("PartName", partName);
  override.setAttribute("ContentType", COMMENTS_TYPE);
  root.appendChild(override);
  zip.file("[Content_Types].xml", xmlWithProlog(serialize(types)));
}
