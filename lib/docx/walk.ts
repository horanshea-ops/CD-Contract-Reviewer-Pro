import { normalizeChar } from "./normalize";
import { NumberingResolver } from "./numbering";
import { branchRead, textBoxesIn } from "./text-boxes";
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
  tableIndex: number | null;
  cellIndex: number | null;
  insideContentControl: boolean;
  insideHyperlink: boolean;
  /** Set between a field's "separate" and "end" — the visible field result. */
  insideField: boolean;
  insideTextBox: boolean;
  insideUneditedMarkup: boolean;
  /** The revision this content belongs to, for the markup view. */
  revision: RevisionInfo | null;
  /** True inside a table cell, where paragraphs separate with a space, not a blank line. */
  inCell: boolean;
  /** Which views this content belongs to, after every revision enclosing it. */
  views: { accepted: boolean; original: boolean };
}

/** Mutable per-paragraph state: the field-code machine, and the text boxes the paragraph anchors. */
interface FieldState {
  /** Between "begin" and "separate": instruction text, never shown to the model. */
  inInstruction: boolean;
  /** Between "separate" and "end": the result, readable but not modifiable. */
  inResult: boolean;
  /** Text boxes met in the paragraph's runs, each with the context of the run that anchors it. */
  boxes: { box: Element; ctx: Ctx }[];
}

const newState = (): FieldState => ({ inInstruction: false, inResult: false, boxes: [] });

/** Wrappers around runs or paragraphs that add no wording of their own. The redline leaves what they hold alone. */
const UNEDITED_WRAPPERS = new Set(["w:smartTag", "w:customXml", "w:dir", "w:bdo"]);

type Views = { accepted: boolean; original: boolean };
const BOTH_VIEWS: Views = { accepted: true, original: true };

class Sink {
  text = "";
  map: MapEntry[] = [];
  originalText = "";
  markup: MarkupSpan[] = [];

  /**
   * Structure we invented: table pipes, heading hashes, list numbers, breaks.
   *
   * `views` says which reading it belongs to, as for wording. A marker left
   * out of the accepted reading carries the revision that struck it, which is
   * how the preview knows it takes up no room in `text`.
   */
  synthetic(s: string, views: Views = BOTH_VIEWS, struckBy: RevisionInfo | null = null) {
    if (!s) return;
    if (views.accepted) {
      for (const ch of s) {
        this.text += ch;
        this.map.push({ synthetic: true });
      }
    }
    if (views.original) this.originalText += s;
    this.markup.push({ text: s, revision: views.accepted ? null : struckBy, synthetic: true });
  }

  /**
   * Text from a run. `views` decides which of the two views it belongs to:
   * an insertion is in the accepted view only, a deletion in the original only.
   */
  real(
    raw: string,
    ref: Omit<SourceRef, "offsetWithinRun">,
    views: { accepted: boolean; original: boolean },
    revision: RevisionInfo | null,
    /** Where this text child starts within the run's concatenated text. */
    baseOffset = 0
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
        // needs to locate the character in the untouched XML. A run may hold
        // more than one text child, so the offset runs across all of them
        // rather than restarting — otherwise two characters in one run share
        // an address and §1.5 splits at the wrong place.
        this.map.push({ ...ref, offsetWithinRun: baseOffset + i });
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

/** A revision that takes wording out of the contract as it now reads. */
const strikes = (rev: RevisionInfo) => rev.kind === "del" || rev.kind === "moveFrom";

/**
 * The context under a revision. Content left out of the accepted reading is
 * tagged with the revision that struck it, so the preview never counts it.
 */
function under<C extends { views: Views; revision: RevisionInfo | null }>(ctx: C, rev: RevisionInfo): C {
  const views = bothOf(ctx.views, REVISION_VIEWS[rev.kind]);
  return { ...ctx, views, revision: views.accepted || strikes(rev) ? rev : ctx.revision };
}

/**
 * Revisions compose by intersection. Wording the counterparty inserted and we
 * then struck (§1.5.7 writes exactly that, a `w:del` inside their `w:ins`) is
 * in neither view: it does not read in the contract as it now stands, and it
 * was not in the contract as first drafted.
 */
const bothOf = (
  outer: { accepted: boolean; original: boolean },
  inner: { accepted: boolean; original: boolean }
) => ({ accepted: outer.accepted && inner.accepted, original: outer.original && inner.original });

function revisionFrom(node: Element): RevisionInfo {
  const kind = tag(node).replace("w:", "") as RevisionKind;
  return {
    kind,
    author: node.getAttribute("w:author") ?? "",
    date: node.getAttribute("w:date") ?? "",
    id: node.getAttribute("w:id") ?? "",
  };
}

/** Where a comment's markers sit, as offsets into the accepted-view text. */
export interface CommentAnchorOffsets {
  start?: number;
  end?: number;
  reference?: number;
}

export interface WalkResult extends ExtractedPart {
  paragraphCount: number;
  runCount: number;
  tableCount: number;
  /**
   * Every run element, indexed by the same `runIndex` the map records.
   *
   * §1.5 has to reach the element to split it and wrap it. Walking a second
   * time to rebuild this order would risk the two walks drifting apart, which
   * is the silent corruption this module already warns about, so the one walk
   * that assigns the indices hands back what it walked.
   */
  runs: Element[];
  /** Comment markers met on the walk, by comment id. They add nothing to the text. */
  commentAnchors: Map<string, CommentAnchorOffsets>;
}

export function walkPart(part: ParsedPart, numbering: NumberingResolver): WalkResult {
  const sink = new Sink();
  const runs: Element[] = [];
  const commentAnchors = new Map<string, CommentAnchorOffsets>();

  /** Notes where a comment marker sits. The first marker of each kind wins. */
  function markComment(node: Element, kind: keyof CommentAnchorOffsets) {
    const id = node.getAttribute("w:id");
    if (id === null) return;
    const anchor = commentAnchors.get(id) ?? {};
    anchor[kind] ??= sink.text.length;
    commentAnchors.set(id, anchor);
  }

  let paragraphIndex = -1;
  let runIndex = -1;
  let tableCount = 0;
  let cellCount = 0;

  const root =
    part.doc.getElementsByTagName("w:body")[0] ??
    part.doc.getElementsByTagName("w:hdr")[0] ??
    part.doc.getElementsByTagName("w:ftr")[0] ??
    part.doc.documentElement;

  const baseCtx: Ctx = {
    part: part.name,
    insideIns: false,
    insideTable: false,
    tableIndex: null,
    cellIndex: null,
    insideContentControl: false,
    insideHyperlink: false,
    insideField: false,
    insideTextBox: false,
    insideUneditedMarkup: false,
    revision: null,
    inCell: false,
    views: { accepted: true, original: true },
  };

  /** Emits the run's text children, honouring the field-code state machine. */
  function walkRun(node: Element, ctx: Ctx, field: FieldState, views: { accepted: boolean; original: boolean }) {
    runIndex++;
    runs.push(node);
    const ref: Omit<SourceRef, "offsetWithinRun"> = {
      part: ctx.part,
      paragraphIndex,
      runIndex,
      insideIns: ctx.insideIns,
      insideTable: ctx.insideTable,
      tableIndex: ctx.tableIndex,
      cellIndex: ctx.cellIndex,
      insideContentControl: ctx.insideContentControl,
      insideField: ctx.insideField || field.inResult,
      insideHyperlink: ctx.insideHyperlink,
      insideTextBox: ctx.insideTextBox,
      insideUneditedMarkup: ctx.insideUneditedMarkup,
    };

    let baseOffset = 0;
    for (const child of childrenOf(node)) {
      switch (tag(child)) {
        case "w:t":
        case "w:delText": {
          const raw = child.textContent ?? "";
          if (!field.inInstruction) sink.real(raw, ref, views, ctx.revision, baseOffset);
          baseOffset += raw.length;
          break;
        }
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
          sink.synthetic("\t", views, ctx.revision);
          break;
        case "w:br":
          sink.synthetic("\n", views, ctx.revision);
          break;
        case "w:noBreakHyphen":
          sink.synthetic("-", views, ctx.revision);
          break;
        case "w:commentReference":
          markComment(child, "reference");
          break;
        case "w:rPr":
          break;
        default:
          // A drawing can hold text boxes. Their wording is read once the paragraph ends.
          for (const box of textBoxesIn(child)) field.boxes.push({ box, ctx });
          break; // w:sym, w:footnoteReference and friends add no wording
      }
    }
  }

  /** Adds a marker to the readings this content belongs to. */
  const mark = (text: string, ctx: Ctx) => sink.synthetic(text, ctx.views, ctx.revision);

  /** Reads the text boxes a paragraph anchored, as paragraphs of their own after it. */
  function walkBoxes(state: FieldState) {
    for (const { box, ctx } of state.boxes.splice(0)) walkChildren(box, { ...ctx, insideTextBox: true });
  }

  /** True when the paragraph holds wording of its own, live or struck. A text box it anchors doesn't count. */
  function hasWording(node: Element): boolean {
    const own = (text: Element) => {
      for (let at = text.parentNode; at && at !== node; at = at.parentNode) if (at.nodeName === "w:txbxContent") return false;
      return true;
    };
    for (const name of ["w:t", "w:delText"]) {
      const texts = node.getElementsByTagName(name);
      for (let i = 0; i < texts.length; i++) if (texts[i].textContent && own(texts[i])) return true;
    }
    return false;
  }

  /**
   * Prefix a paragraph with its heading marker, its list number, or both, all
   * synthetic. A numbered heading reads "# 1. ", and a list item is indented
   * by its level.
   *
   * A heading style marks no heading on an empty paragraph, inside a table
   * cell or inside a text box. Word's own outline leaves all three out.
   */
  function paragraphPrefix(node: Element, ctx: Ctx): string {
    const pPr = firstChild(node, "w:pPr");
    const level = ctx.inCell || ctx.insideTextBox || !hasWording(node) ? 0 : numbering.styles.headingLevelOf(pPr);
    const hashes = level ? `${"#".repeat(level)} ` : "";

    // A paragraph out of the accepted reading takes no number, so the count follows the contract as it now reads.
    const list = ctx.views.accepted ? numbering.numberingOf(pPr) : null;
    if (!list) return hashes;

    const label = numbering.next(list.numId, list.ilvl);
    if (label === "") return hashes;
    if (hashes) return label === null ? hashes : `${hashes}${label} `;
    return `${"  ".repeat(list.ilvl)}${label ?? "-"} `;
  }

  /**
   * A table's rows, or a row's cells, with those a content control or a
   * custom-XML wrapper holds. Each comes with the lock its wrapper puts on it.
   */
  function unwrapped(node: Element, name: string, lock: Partial<Ctx> = {}): { el: Element; lock: Partial<Ctx> }[] {
    return childrenOf(node).flatMap((child) => {
      const kind = tag(child);
      if (kind === name) return [{ el: child, lock }];
      if (kind === "w:sdt" || kind === "w:sdtContent") return unwrapped(child, name, { ...lock, insideContentControl: true });
      if (kind === "w:customXml") return unwrapped(child, name, { ...lock, insideUneditedMarkup: true });
      return [];
    });
  }

  /** The tracked change on a table row itself, which strikes or adds the whole row. */
  function rowRevision(row: Element): RevisionInfo | null {
    const trPr = firstChild(row, "w:trPr");
    const change = trPr ? childrenOf(trPr).find((c) => REVISION_TAGS.has(tag(c))) : undefined;
    return change ? revisionFrom(change) : null;
  }

  function walkTable(node: Element, ctx: Ctx) {
    const tableIndex = tableCount++;
    const rows = unwrapped(node, "w:tr").map((row) => {
      const rev = rowRevision(row.el);
      return { ...row, ctx: rev ? under(ctx, rev) : ctx };
    });

    // A table with no row left to read is out of the reading altogether.
    // Accepting the changes removes it.
    const edge = rows.length > 0 && !rows.some((row) => row.ctx.views.accepted) ? rows[0].ctx : ctx;

    mark("\n", edge);
    let ruled = false;
    for (const row of rows) {
      const cells = unwrapped(row.el, "w:tc", row.lock);
      mark("|", row.ctx);
      for (const cell of cells) {
        mark(" ", row.ctx);
        walkChildren(cell.el, { ...row.ctx, ...cell.lock, insideTable: true, inCell: true, tableIndex, cellIndex: cellCount++ });
        mark(" |", row.ctx);
      }
      mark("\n", row.ctx);
      // A separator after the first row that reads is what makes this a table
      // rather than a row of pipes — §1.4.5's point about cancellation
      // schedules reaching the model as a grid.
      if (!ruled && row.ctx.views.accepted) {
        ruled = true;
        mark("|", row.ctx);
        for (let i = 0; i < cells.length; i++) mark(" --- |", row.ctx);
        mark("\n", row.ctx);
      }
    }
    mark("\n", edge);
  }

  function walkParagraph(node: Element, ctx: Ctx) {
    paragraphIndex++;
    mark(paragraphPrefix(node, ctx), ctx);
    const state = newState();
    walkChildren(node, ctx, state);
    // Inside a cell the paragraph break would break the table row apart.
    mark(ctx.inCell ? " " : "\n\n", ctx);
    walkBoxes(state);
  }

  function walkChildren(node: Element, ctx: Ctx, field?: FieldState) {
    for (const child of childrenOf(node)) {
      const name = tag(child);
      if (name === "w:pPr" || name === "w:rPr" || name === "w:tblPr" || name === "w:tcPr" || name === "w:trPr" || name === "w:sectPr") continue;

      if (name === "w:p") { walkParagraph(child, ctx); continue; }
      if (name === "w:tbl") { walkTable(child, ctx); continue; }
      if (name === "w:r") {
        const state = field ?? newState();
        walkRun(child, ctx, state, ctx.views);
        // A run outside any paragraph has no paragraph end to wait for.
        if (!field) walkBoxes(state);
        continue;
      }
      if (REVISION_TAGS.has(name)) {
        const rev = revisionFrom(child);
        const inner: Ctx = { ...under(ctx, rev), insideIns: ctx.insideIns || rev.kind === "ins" || rev.kind === "moveTo" };
        // Descending through the same dispatch keeps the views: a revision can
        // wrap paragraphs, hyperlinks and further revisions, and each of those
        // carries runs that belong to the enclosing revision, not to both views.
        walkChildren(child, inner, field);
        continue;
      }
      if (name === "w:hyperlink") { walkChildren(child, { ...ctx, insideHyperlink: true }, field); continue; }
      if (name === "w:sdt") {
        const content = firstChild(child, "w:sdtContent");
        if (content) walkChildren(content, { ...ctx, insideContentControl: true }, field);
        continue;
      }
      if (name === "w:sdtContent") { walkChildren(child, { ...ctx, insideContentControl: true }, field); continue; }
      if (name === "w:fldSimple") { walkChildren(child, { ...ctx, insideField: true }, field); continue; }
      if (name === "mc:AlternateContent") {
        // Two copies of the same content, of which one is read.
        const branch = branchRead(child);
        if (branch) walkChildren(branch, { ...ctx, insideUneditedMarkup: true }, field);
        continue;
      }
      if (UNEDITED_WRAPPERS.has(name)) { walkChildren(child, { ...ctx, insideUneditedMarkup: true }, field); continue; }

      // Structural containers we simply descend into.
      if (name === "w:body" || name === "w:tc" || name === "w:tr" || name === "w:hdr" || name === "w:ftr") {
        walkChildren(child, ctx, field);
        continue;
      }
      if (name === "w:commentRangeStart") { markComment(child, "start"); continue; }
      if (name === "w:commentRangeEnd") { markComment(child, "end"); continue; }
      // bookmarkStart/End, proofErr, lastRenderedPageBreak: no text.
    }
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
    runs,
    commentAnchors,
  };
}
