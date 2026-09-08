import { collapseWhitespace, normalizeText } from "../docx/normalize";
import { childElements, isRevisionTag, type ReadPackage, type RevisionTag } from "./package";

/**
 * The reject-all round trip (MASTER_PLAN.md §1.6.2) — the strongest check
 * available, and cheap.
 *
 * One correction to the plan text. It says the *original* view of the output
 * must equal the accepted view of the input. That holds only for a document
 * with no tracked changes in it already. Rejecting every revision also unwinds
 * the property's own edits and winds the contract back past what they sent, so
 * the check must reject only the revisions this export wrote and accept
 * everyone else's. docs/live-engine-validation.md records this correction being
 * made once and then reintroduced; it lives in code here, with a test named
 * after it.
 *
 * Attribution is by revision id, not author name, so an export stays verifiable
 * when the property's counsel happens to share a name with the associate.
 */

export interface Ownership {
  /** `w:id` values the engine reported writing. Preferred. */
  ownIds: Set<string>;
  /** Author name, used only when the engine reported no ids. */
  ownAuthor: string | null;
}

/** Which revisions this export owns. */
function isOurs(own: Ownership, id: string, author: string): boolean {
  if (own.ownIds.size > 0) return own.ownIds.has(id);
  return own.ownAuthor !== null && author === own.ownAuthor;
}

/** Keep the text this revision wraps, under the view being built? */
type Policy = (tag: RevisionTag, id: string, author: string) => boolean;

/** The contract as it currently reads: their insertions in, their deletions out. */
const acceptAll: Policy = (tag) => tag === "w:ins" || tag === "w:moveTo";

/** Ours rejected, everyone else's accepted. */
function rejectOurs(own: Ownership): Policy {
  return (tag, id, author) => {
    if (!isOurs(own, id, author)) return acceptAll(tag, id, author);
    return tag === "w:del" || tag === "w:moveFrom";
  };
}

/**
 * Text of every paragraph in a part, under one policy.
 *
 * Structure the extractor invents — table pipes, heading hashes, list numbers —
 * is left out. An inserted paragraph contributes structure that survives a
 * rejection and would read as a difference that is not one. Empty paragraphs
 * drop out for the same reason: rejecting an inserted paragraph empties it,
 * and the input never had it.
 *
 * Compared as an array rather than one string, because a merged or lost
 * paragraph is invisible once the text is concatenated.
 */
function paragraphTexts(doc: Document, policy: Policy): string[] {
  const paragraphs: string[] = [];

  function text(el: Element, out: { s: string }) {
    for (const child of childElements(el)) {
      const name = child.nodeName;

      if (name === "w:pPr" || name === "w:rPr") continue; // properties, and the paragraph-mark revision

      if (isRevisionTag(name)) {
        // Composition matters. Our deletion nested inside their insertion must
        // restore its text, because the input's accepted view contained it, so
        // a span survives only when every wrapper around it keeps it.
        if (!policy(name, child.getAttribute("w:id") ?? "", child.getAttribute("w:author") ?? "")) continue;
        text(child, out);
        continue;
      }

      if (name === "w:t" || name === "w:delText" || name === "w:instrText") {
        out.s += child.textContent ?? "";
        continue;
      }
      if (name === "w:tab" || name === "w:br" || name === "w:cr") {
        out.s += " ";
        continue;
      }
      if (name === "w:noBreakHyphen") {
        out.s += "-";
        continue;
      }
      if (name === "w:p") continue; // reached on its own pass

      text(child, out);
    }
  }

  const nodes = doc.getElementsByTagName("w:p");
  for (let i = 0; i < nodes.length; i++) {
    const out = { s: "" };
    text(nodes[i], out);
    const normalized = collapseWhitespace(normalizeText(out.s));
    if (normalized) paragraphs.push(normalized);
  }
  return paragraphs;
}

export interface RoundTripResult {
  passed: boolean;
  /** Plain language for the associate when it failed. */
  detail: string;
}

/**
 * Rejecting our changes in the output must give back exactly the contract the
 * property sent. Anything else means content was corrupted or lost.
 */
export function checkRejectRoundTrip(
  input: ReadPackage,
  output: ReadPackage,
  own: Ownership
): RoundTripResult {
  // Without ids we fall back to the author name, which cannot tell our
  // revisions from identically-authored ones already in the document. Say so
  // rather than report a pass the check did not earn.
  if (own.ownIds.size === 0 && own.ownAuthor) {
    for (const part of input.textParts) {
      const tags = ["w:ins", "w:del", "w:moveFrom", "w:moveTo"];
      for (const tag of tags) {
        const nodes = part.doc.getElementsByTagName(tag);
        for (let i = 0; i < nodes.length; i++) {
          if (nodes[i].getAttribute("w:author") === own.ownAuthor) {
            return {
              passed: false,
              detail:
                `The document already contains tracked changes by "${own.ownAuthor}", so this export's own ` +
                `changes cannot be told apart from them and the file cannot be verified.`,
            };
          }
        }
      }
    }
  }

  const policy = rejectOurs(own);

  for (const inPart of input.textParts) {
    const outPart = output.xmlParts.get(inPart.path);
    if (!outPart) {
      return { passed: false, detail: `${inPart.path} is missing from the marked-up copy.` };
    }

    const want = paragraphTexts(inPart.doc, acceptAll);
    const got = paragraphTexts(outPart.doc, policy);

    const limit = Math.min(want.length, got.length);
    for (let i = 0; i < limit; i++) {
      if (want[i] === got[i]) continue;
      return { passed: false, detail: describeMismatch(inPart.path, i, want[i], got[i]) };
    }
    if (want.length !== got.length) {
      const extra = got.length > want.length;
      const at = limit;
      return {
        passed: false,
        detail:
          `${inPart.path}: rejecting the changes leaves ${got.length} paragraph(s) where the original had ` +
          `${want.length}. ${extra ? `Unexpected: "${clip(got[at])}"` : `Lost: "${clip(want[at])}"`}`,
      };
    }
  }

  return { passed: true, detail: "Rejecting every change returns the document the property sent, exactly." };
}

const clip = (s: string, n = 70) => (s.length > n ? s.slice(0, n) + "…" : s);

function describeMismatch(path: string, index: number, want: string, got: string): string {
  let i = 0;
  while (i < want.length && i < got.length && want[i] === got[i]) i++;
  const from = Math.max(0, i - 25);
  return (
    `${path}, paragraph ${index + 1}: rejecting the changes does not restore the original wording. ` +
    `Expected "${clip(want.slice(from, i + 45))}" but got "${clip(got.slice(from, i + 45))}".`
  );
}

/**
 * Rejecting our changes gives back the same number of paragraphs.
 *
 * The text comparison above cannot see this one. An inserted paragraph whose
 * paragraph *mark* was never marked as inserted empties out on a reject and
 * leaves a blank paragraph behind — no text, so no textual difference, but a
 * stray empty paragraph sitting in the property's contract. Stage 0 found
 * exactly that (docs/live-engine-validation.md, defect 3).
 *
 * Rejecting an inserted paragraph mark merges that paragraph into the next, so
 * the count after a reject is the output's paragraphs less the ones whose marks
 * we inserted. Deleted paragraph marks are restored by a reject and do not move
 * the count.
 */
export function checkParagraphCount(
  input: ReadPackage,
  output: ReadPackage,
  own: Ownership
): RoundTripResult {
  for (const inPart of input.textParts) {
    const outPart = output.xmlParts.get(inPart.path);
    if (!outPart) continue; // reported by parts_preserved

    const before = inPart.doc.getElementsByTagName("w:p").length;
    const nodes = outPart.doc.getElementsByTagName("w:p");
    let ourInsertedMarks = 0;
    for (let i = 0; i < nodes.length; i++) {
      const mark = insertedParagraphMark(nodes[i]);
      if (mark && isOurs(own, mark.id, mark.author)) ourInsertedMarks++;
    }
    const after = nodes.length - ourInsertedMarks;

    if (after !== before) {
      return {
        passed: false,
        detail:
          `${inPart.path}: rejecting the changes leaves ${after} paragraph(s) where the original had ${before}. ` +
          (after > before
            ? "An added paragraph would stay in the document even after the property rejects every change."
            : "A paragraph of the original would be lost."),
      };
    }
  }
  return { passed: true, detail: "Rejecting every change restores the original paragraph structure." };
}

/** The `w:ins` in a paragraph's pPr/rPr, which marks the paragraph mark itself as inserted. */
function insertedParagraphMark(p: Element): { id: string; author: string } | null {
  const pPr = childElements(p).find((c) => c.nodeName === "w:pPr");
  if (!pPr) return null;
  const rPr = childElements(pPr).find((c) => c.nodeName === "w:rPr");
  if (!rPr) return null;
  const ins = childElements(rPr).find((c) => c.nodeName === "w:ins");
  if (!ins) return null;
  return { id: ins.getAttribute("w:id") ?? "", author: ins.getAttribute("w:author") ?? "" };
}
