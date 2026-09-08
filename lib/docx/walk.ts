import { normalizeChar } from "./normalize";
import { NumberingResolver } from "./numbering";
import type { ParsedPart } from "./parts";
import type {
  ExtractedPart,
  MapEntry,
  MarkupSpan,
  RevisionInfo,
  RevisionKind,
  SourceRef,
} from "./types";

/**
 * One walk over a part, producing the three views and the source map together
 * (MASTER_PLAN.md §1.4.3, §1.4.4).
 *
 * Doing it in a single pass is the point. Text and map are appended character
 * by character from the same loop, so they cannot drift apart — which they
 * would if normalisation ran as a separate pass over finished text, because
 * dropping a soft hyphen shifts every offset after it.
 */

interface Ctx {
  part: string;
  insideIns: boolean;
  insideTable: boolean;
  insideContentControl: boolean;
  insideHyperlink: boolean;
  /** Set between a field's "separate" and "end" — the visible field result. */
  insideField: boolean;
  /** The revision this content belongs to, for the markup view. */
  revision: RevisionInfo | null;
  /** True inside a table cell, where paragraphs separate with a space, not a blank line. */
  inCell: boolean;
}

/** Mutable per-paragraph state for the field-code machine. */
interface FieldState {
  /** Between "begin" and "separate": instruction text, never shown to the model. */
  inInstruction: boolean;
  /** Between "separate" and "end": the result, readable but not modifiable. */
  inResult: boolean;
}

class Sink {
  text = "";
  map: MapEntry[] = [];
  originalText = "";
  markup: MarkupSpan[] = [];

  /** Structure we invented: table pipes, heading hashes, list numbers, breaks. */
  synthetic(s: string) {
    if (!s) return;
    for (const ch of s) {
      this.text += ch;
      this.map.push({ synthetic: true });
    }
    this.originalText += s;
    this.markup.push({ text: s, revision: null, synthetic: true });
  }

  /**
   * Text from a run. `views` decides which of the two views it belongs to:
   * an insertion is in the accepted view only, a deletion in the original only.
   */
  real(
    raw: string,
    ref: Omit<SourceRef, "offsetWithinRun">,
    views: { accepted: boolean; original: boolean },
    revision: RevisionInfo | null
  ) {
    if (!raw) return;
    let normalized = "";
    for (let i = 0; i < raw.length; i++) {
      const out = normalizeChar(raw[i]);
      if (!out) continue; // dropped, e.g. a soft hyphen
      normalized += out;
      if (views.accepted) {
        this.text += out;
        // offsetWithinRun points at the ORIGINAL index, which is what §1.5
        // needs to locate the character in the untouched XML.
        this.map.push({ ...ref, offsetWithinRun: i });
      }
    }
    if (views.original) this.originalText += normalized;
    if (normalized) this.markup.push({ text: normalized, revision, synthetic: false });
  }
}

const el = (n: Node): Element | null => (n.nodeType === 1 ? (n as Element) : null);
const tag = (n: Element) => n.nodeName;
const childrenOf = (n: Element): Element[] => {
  const out: Element[] = [];
  for (let i = 0; i < n.childNodes.length; i++) {
    const c = el(n.childNodes[i]);
    if (c) out.push(c);
  }
  return out;
};
const firstChild = (n: Element, name: string): Element | null =>
  childrenOf(n).find((c) => tag(c) === name) ?? null;

/** How a revision wrapper maps onto the two views. */
const REVISION_VIEWS: Record<RevisionKind, { accepted: boolean; original: boolean }> = {
  // Their insertion is in the contract as it now reads, but was not in the original.
  ins: { accepted: true, original: false },
  del: { accepted: false, original: true },
  // A move is not a delete plus an insert: the text left moveFrom and arrived at
  // moveTo, so it appears exactly once in each view, in different places.
  moveTo: { accepted: true, original: false },
  moveFrom: { accepted: false, original: true },
};

const REVISION_TAGS = new Set(["w:ins", "w:del", "w:moveTo", "w:moveFrom"]);

function revisionFrom(node: Element): RevisionInfo {
  const kind = tag(node).replace("w:", "") as RevisionKind;
  return {
    kind,
    author: node.getAttribute("w:author") ?? "",
    date: node.getAttribute("w:date") ?? "",
    id: node.getAttribute("w:id") ?? "",
  };
}

export interface WalkResult extends ExtractedPart {
  paragraphCount: number;
  runCount: number;
  tableCount: number;
}

export function walkPart(part: ParsedPart, numbering: NumberingResolver): WalkResult {
  const sink = new Sink();
  let paragraphIndex = -1;
  let runIndex = -1;
  let tableCount = 0;

  const root =
    part.doc.getElementsByTagName("w:body")[0] ??
    part.doc.getElementsByTagName("w:hdr")[0] ??
    part.doc.getElementsByTagName("w:ftr")[0] ??
    part.doc.documentElement;

  const baseCtx: Ctx = {
    part: part.name,
    insideIns: false,
    insideTable: false,
    insideContentControl: false,
    insideHyperlink: false,
    insideField: false,
    revision: null,
    inCell: false,
  };

  /** Emits the run's text children, honouring the field-code state machine. */
  function walkRun(node: Element, ctx: Ctx, field: FieldState, views: { accepted: boolean; original: boolean }) {
    runIndex++;
    const ref: Omit<SourceRef, "offsetWithinRun"> = {
      part: ctx.part,
      paragraphIndex,
      runIndex,
      insideIns: ctx.insideIns,
      insideTable: ctx.insideTable,
      insideContentControl: ctx.insideContentControl,
      insideField: ctx.insideField || field.inResult,
      insideHyperlink: ctx.insideHyperlink,
    };

    for (const child of childrenOf(node)) {
      switch (tag(child)) {
        case "w:t":
          if (!field.inInstruction) sink.real(child.textContent ?? "", ref, views, ctx.revision);
          break;
        case "w:delText":
          if (!field.inInstruction) sink.real(child.textContent ?? "", ref, views, ctx.revision);
          break;
        case "w:instrText":
          // §1.4.7: field instructions are machinery, never contract language.
          break;
        case "w:fldChar": {
          const type = child.getAttribute("w:fldCharType");
          if (type === "begin") { field.inInstruction = true; field.inResult = false; }
          else if (type === "separate") { field.inInstruction = false; field.inResult = true; }
          else if (type === "end") { field.inInstruction = false; field.inResult = false; }
          break;
        }
        case "w:tab":
          // Synthetic: a tab is structure, not a character inside any run's text,
          // so it has nowhere to map back to and must never be edited.
          sink.synthetic("\t");
          break;
        case "w:br":
          sink.synthetic("\n");
          break;
        case "w:noBreakHyphen":
          sink.synthetic("-");
          break;
        default:
          break; // w:rPr, w:sym, w:drawing, w:footnoteReference and friends
      }
    }
  }

  /** Prefix a paragraph with its heading marker or list number, both synthetic. */
  function paragraphPrefix(node: Element): string {
    const pPr = firstChild(node, "w:pPr");
    if (!pPr) return "";

    const numPr = firstChild(pPr, "w:numPr");
    if (numPr) {
      const numId = firstChild(numPr, "w:numId")?.getAttribute("w:val");
      const ilvl = Number(firstChild(numPr, "w:ilvl")?.getAttribute("w:val") ?? "0");
      if (numId) {
        const label = numbering.next(numId, ilvl);
        if (label) return `${"  ".repeat(ilvl)}${label} `;
      }
      return `${"  ".repeat(ilvl)}- `;
    }

    const style = firstChild(pPr, "w:pStyle")?.getAttribute("w:val") ?? "";
    const outline = firstChild(pPr, "w:outlineLvl")?.getAttribute("w:val");
    const m = /^Heading(\d)$/i.exec(style);
    const level = m ? Number(m[1]) : outline != null ? Number(outline) + 1 : 0;
    if (level >= 1 && level <= 6) return `${"#".repeat(level)} `;
    return "";
  }

  function walkTable(node: Element, ctx: Ctx) {
    tableCount++;
    sink.synthetic("\n");
    const rows = childrenOf(node).filter((c) => tag(c) === "w:tr");
    rows.forEach((row, rowIdx) => {
      const cells = childrenOf(row).filter((c) => tag(c) === "w:tc");
      sink.synthetic("|");
      for (const cell of cells) {
        sink.synthetic(" ");
        walkChildren(cell, { ...ctx, insideTable: true, inCell: true });
        sink.synthetic(" |");
      }
      sink.synthetic("\n");
      // A separator after the first row is what makes this read as a table
      // rather than a row of pipes — §1.4.5's point about cancellation
      // schedules reaching the model as a grid.
      if (rowIdx === 0) {
        sink.synthetic("|");
        for (let i = 0; i < cells.length; i++) sink.synthetic(" --- |");
        sink.synthetic("\n");
      }
    });
    sink.synthetic("\n");
  }

  function walkParagraph(node: Element, ctx: Ctx) {
    paragraphIndex++;
    sink.synthetic(paragraphPrefix(node));
    const field: FieldState = { inInstruction: false, inResult: false };
    walkChildren(node, ctx, field);
    // Inside a cell the paragraph break would break the table row apart.
    sink.synthetic(ctx.inCell ? " " : "\n\n");
  }

  function walkChildren(node: Element, ctx: Ctx, field?: FieldState) {
    for (const child of childrenOf(node)) {
      const name = tag(child);
      if (name === "w:pPr" || name === "w:rPr" || name === "w:tblPr" || name === "w:tcPr" || name === "w:trPr" || name === "w:sectPr") continue;

      if (name === "w:p") { walkParagraph(child, ctx); continue; }
      if (name === "w:tbl") { walkTable(child, ctx); continue; }
      if (name === "w:r") {
        walkRun(child, ctx, field ?? { inInstruction: false, inResult: false }, viewsFor(ctx));
        continue;
      }
      if (REVISION_TAGS.has(name)) {
        const rev = revisionFrom(child);
        const inner: Ctx = { ...ctx, insideIns: ctx.insideIns || rev.kind === "ins" || rev.kind === "moveTo", revision: rev };
        walkRevision(child, inner, rev, field);
        continue;
      }
      if (name === "w:hyperlink") { walkChildren(child, { ...ctx, insideHyperlink: true }, field); continue; }
      if (name === "w:sdt") {
        const content = firstChild(child, "w:sdtContent");
        if (content) walkChildren(content, { ...ctx, insideContentControl: true }, field);
        continue;
      }
      if (name === "w:sdtContent") { walkChildren(child, { ...ctx, insideContentControl: true }, field); continue; }

      // Structural containers we simply descend into.
      if (name === "w:body" || name === "w:tc" || name === "w:tr" || name === "w:hdr" || name === "w:ftr") {
        walkChildren(child, ctx, field);
        continue;
      }
      // bookmarkStart/End, proofErr, commentRangeStart/End, lastRenderedPageBreak: no text.
    }
  }

  function walkRevision(node: Element, ctx: Ctx, rev: RevisionInfo, field?: FieldState) {
    const views = REVISION_VIEWS[rev.kind];
    for (const child of childrenOf(node)) {
      if (tag(child) === "w:r") {
        walkRun(child, ctx, field ?? { inInstruction: false, inResult: false }, views);
      } else {
        // A revision can wrap paragraphs and nested revisions too.
        walkChildren(child, ctx, field);
      }
    }
  }

  /** Plain content sits in both views; content inside a revision is handled by walkRevision. */
  function viewsFor(_ctx: Ctx) {
    return { accepted: true, original: true };
  }

  walkChildren(root as Element, baseCtx);

  return {
    part: part.name,
    text: sink.text,
    map: sink.map,
    originalText: sink.originalText,
    markup: sink.markup,
    paragraphCount: paragraphIndex + 1,
    runCount: runIndex + 1,
    tableCount,
  };
}
