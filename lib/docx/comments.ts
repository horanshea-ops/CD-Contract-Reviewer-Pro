import type { DocxPackage } from "./parts";
import { parseXml } from "./parts";
import { isSynthetic, type DocumentComment, type MapEntry } from "./types";
import type { WalkResult } from "./walk";

/**
 * Comments already in the file (MASTER_PLAN.md §1.4).
 *
 * A comment is someone's note about the contract, so it is read beside the
 * contract text and never into it. The walk records where each comment's
 * markers sit, and this module joins those offsets to the comment's words.
 *
 * Comment text is written by whoever marked the file up. Callers treat it as
 * something to show and to weigh, never as contract wording.
 */

/** A file with more comments than this has the rest left out. */
export const COMMENT_LIMIT = 100;
/** A longer comment is cut here. */
export const COMMENT_TEXT_LIMIT = 500;
const QUOTE_LIMIT = 200;

const RELS_PATH = "word/_rels/document.xml.rels";
const COMMENTS_REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments";
const EXTENDED_REL = "http://schemas.microsoft.com/office/2011/relationships/commentsExtended";

const elements = (root: Document | Element, tag: string): Element[] => {
  const nodes = root.getElementsByTagName(tag);
  const out: Element[] = [];
  for (let i = 0; i < nodes.length; i++) out.push(nodes[i]);
  return out;
};

const clip = (text: string, limit: number) => (text.length > limit ? `${text.slice(0, limit).trimEnd()}…` : text);

/** The part a relationship of this type points at, or the usual path when the file declares none. */
async function partFor(pkg: DocxPackage, type: string, usual: string): Promise<Document | null> {
  let path = usual;
  const rels = pkg.zip.file(RELS_PATH);
  if (rels) {
    const doc = parseXml(await rels.async("string"), RELS_PATH);
    const target = elements(doc, "Relationship")
      .find((r) => r.getAttribute("Type") === type)
      ?.getAttribute("Target");
    if (target) path = target.startsWith("/") ? target.slice(1) : `word/${target}`;
  }
  const file = pkg.zip.file(path);
  return file ? parseXml(await file.async("string"), path) : null;
}

/** A comment's words, one line per paragraph, with empty paragraphs left out. */
function commentText(comment: Element): string {
  const lines = elements(comment, "w:p")
    .map((p) =>
      elements(p, "w:t")
        .map((t) => t.textContent ?? "")
        .join("")
        .replace(/\s+/g, " ")
        .trim()
    )
    .filter(Boolean);
  return clip(lines.join("\n"), COMMENT_TEXT_LIMIT);
}

/** The wording in a range, with the layout markers we add read as a single space. */
function quotedWording(text: string, map: MapEntry[], start: number, end: number): string {
  let out = "";
  let gap = false;
  for (let i = start; i < end; i++) {
    if (isSynthetic(map[i]) || /\s/.test(text[i])) {
      gap = true;
      continue;
    }
    if (gap && out) out += " ";
    gap = false;
    out += text[i];
  }
  return clip(out, QUOTE_LIMIT);
}

interface Thread {
  replyTo: string | null;
  resolved: boolean;
}

/**
 * Replies and resolved flags, by comment id. Word keeps them in a separate
 * part that names each comment by the id of one of its paragraphs.
 */
function threads(comments: Element[], extended: Document | null): Map<string, Thread> {
  const out = new Map<string, Thread>();
  if (!extended) return out;

  const commentOf = new Map<string, string>();
  for (const comment of comments) {
    const id = comment.getAttribute("w:id") ?? "";
    for (const p of elements(comment, "w:p")) {
      const paraId = p.getAttribute("w14:paraId");
      if (paraId) commentOf.set(paraId, id);
    }
  }

  for (const entry of elements(extended, "w15:commentEx")) {
    const id = commentOf.get(entry.getAttribute("w15:paraId") ?? "");
    if (id === undefined) continue;
    const parent = commentOf.get(entry.getAttribute("w15:paraIdParent") ?? "");
    out.set(id, { replyTo: parent ?? null, resolved: entry.getAttribute("w15:done") === "1" });
  }
  return out;
}

export async function readComments(
  pkg: DocxPackage,
  parts: WalkResult[]
): Promise<{ comments: DocumentComment[]; total: number }> {
  const doc = await partFor(pkg, COMMENTS_REL, "word/comments.xml");
  if (!doc) return { comments: [], total: 0 };

  const entries = elements(doc, "w:comment");
  const thread = threads(entries, await partFor(pkg, EXTENDED_REL, "word/commentsExtended.xml"));

  const found: { comment: DocumentComment; partOrder: number }[] = [];
  for (const entry of entries) {
    const id = entry.getAttribute("w:id") ?? "";

    // A comment nothing in the document points at does not show in Word either.
    const partOrder = parts.findIndex((p) => p.commentAnchors.has(id));
    if (partOrder === -1) continue;
    const part = parts[partOrder];
    const anchor = part.commentAnchors.get(id)!;

    const start = anchor.start ?? anchor.reference ?? anchor.end ?? 0;
    const end = Math.max(start, anchor.end ?? anchor.reference ?? start);

    found.push({
      partOrder,
      comment: {
        id,
        author: entry.getAttribute("w:author") ?? "",
        date: entry.getAttribute("w:date") ?? "",
        text: commentText(entry),
        part: part.part,
        start,
        end,
        quoted: anchor.start === undefined ? "" : quotedWording(part.text, part.map, start, end),
        replyTo: thread.get(id)?.replyTo ?? null,
        resolved: thread.get(id)?.resolved ?? false,
      },
    });
  }

  found.sort(
    (a, b) => a.partOrder - b.partOrder || a.comment.start - b.comment.start || Number(a.comment.id) - Number(b.comment.id)
  );
  return { comments: found.slice(0, COMMENT_LIMIT).map((f) => f.comment), total: found.length };
}
