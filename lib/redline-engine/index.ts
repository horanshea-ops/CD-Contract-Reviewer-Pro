import { NumberingResolver, isSynthetic, loadDocx, walkPart, type ParsedPart, type WalkResult } from "../docx";
import type { RedlineEngineResult, UnappliedFinding, UnappliedReason, WidenedChange } from "../redline-validation/types";
import { assessApplicability } from "./applicability";
import { splitAcrossCells } from "./cell-split";
import { fitToProposal } from "./fit";
import { revisionsById, revisionsIn, writeComments, type CommentAnchor } from "./comments";
import { RevisionIds } from "./ids";
import { locateQuote } from "./locate";
import { appendClauses } from "./paragraphs";
import { dropRestated, rewritesExistingWording, struckSentences } from "./restated";
import { childElements, replaceSpan, setParagraphMark, strikeAndInsert } from "./revise";
import { isCommentAnchor, runsForSpan } from "./runs";
import { copyHolding, editCopy, layOut, replaceTable } from "./tables";
import { serializePart } from "./serialize";
import { wordingProblem } from "./wording";
import { isLocated, type Applicability, type LocatedSpan, type QuotePlace, type RevisionFinding, type SpanResolution } from "./types";

export * from "./types";

/**
 * The revision engine (MASTER_PLAN.md §1.5).
 *
 * Reads the uploaded document into a tree, finds the wording each finding
 * quotes, and writes real Word tracked changes into it. Only the parts it
 * actually edits are written back.
 *
 * Everything it produces goes through §1.6's oracle before an associate can
 * download it, so a mistake here becomes a fallback to the marked-up PDF rather
 * than a corrupt file sent to a hotel.
 */

/** What the associate is told, per applicability verdict. */
const REASON_FOR: Record<Exclude<Applicability, "applicable" | "blocked_wording">, UnappliedReason> = {
  blocked_table: "crosses_boundary",
  blocked_content_control: "in_content_control",
  blocked_field: "in_field",
  blocked_cross_paragraph: "crosses_boundary",
  blocked_already_deleted: "overlaps_another_change",
};

/** What became of one finding. The review card and the export both read this. */
export interface Resolution {
  findingId: string;
  spanResolution: SpanResolution;
  applicability: Applicability;
  /** One sentence in plain language. */
  detail: string;
  /** Why the change was left out, or null when it went in. */
  reason: UnappliedReason | null;
  /** The finding whose change this one overlaps, when that is why it was left out. */
  conflictsWith?: string;
  /** Each place the quote was found, when nothing says which is meant. */
  places?: QuotePlace[];
  /** The wording that went in, which can differ from the proposal when a repeated sentence was dropped. */
  wording?: string;
  /** Contract wording the change strikes beyond the finding's quote. */
  alsoStrikes?: string;
}

export interface RedlineOutcome extends RedlineEngineResult {
  /** Per finding, for writing back to `findings` (§1.5.1, §1.5.3). */
  resolutions: Resolution[];
  /** Findings that were not applied, by id, in the order `unapplied` lists them. */
  unappliedIds: string[];
  /** Comment ids this run wrote, for the clean copy to strip. */
  ownCommentIds: string[];
  /** True when this run added comments.xml, so the clean copy removes the part again. */
  createdCommentsPart: boolean;
}

/** The opening of a sentence, for naming it in a resolution detail. */
function excerpt(sentence: string): string {
  const opening = sentence.split(/\s+/).slice(0, 8).join(" ");
  return opening.length < sentence.trim().length ? `${opening.replace(/[,;:]$/, "")}…` : opening;
}

const flat = (s: string) => s.replace(/\s+/g, " ").trim();

/** One paragraph's share of a change that spans several. */
interface ParagraphPiece {
  span: LocatedSpan;
  /** The wording this paragraph should read. */
  wording: string;
  changed: boolean;
}

/**
 * One change over wording that runs across paragraphs, as a rewrite does. The
 * old wording is struck in every paragraph, the new wording goes in the first,
 * and the breaks between are deleted so the emptied paragraphs close up into
 * it. Word gives the joined paragraph the first one's formatting.
 */
interface JoinedPiece {
  /** The wording covered in each paragraph, in order. */
  spans: LocatedSpan[];
  wording: string;
  /** False when the last paragraph keeps wording after the quote. It then stays a paragraph of its own. */
  coversLast: boolean;
}

type Piece = ParagraphPiece | JoinedPiece;

const isJoined = (piece: Piece): piece is JoinedPiece => "spans" in piece;

/** The wording a span covers in one paragraph. */
interface Stretch {
  cell: number | null;
  paragraph: number;
  start: number;
  end: number;
}

/** A span's wording, one stretch per paragraph, in document order. */
function stretchesIn(part: WalkResult, span: LocatedSpan): Stretch[] {
  const stretches: Stretch[] = [];
  for (let i = span.start; i < span.end && i < part.map.length; i++) {
    const entry = part.map[i];
    if (isSynthetic(entry)) continue;
    const last = stretches[stretches.length - 1];
    if (last && last.paragraph === entry.paragraphIndex) last.end = i + 1;
    else stretches.push({ cell: entry.cellIndex, paragraph: entry.paragraphIndex, start: i, end: i + 1 });
  }
  return stretches;
}

/** Each stretch with the wording it should read, or null when the wording can't be laid across them. */
function piecesFor(part: WalkResult, span: LocatedSpan, stretches: Stretch[], proposal: string): ParagraphPiece[] | null {
  const now = stretches.map((s) => part.text.slice(s.start, s.end));
  const wording = splitAcrossCells(now, proposal);
  if (!wording) return null;

  return stretches.map((s, i) => ({
    span: { ...span, start: s.start, end: s.end },
    wording: wording[i],
    changed: flat(wording[i]) !== flat(now[i]),
  }));
}

/** The stretches as one joined change. */
function joinedPiece(part: WalkResult, span: LocatedSpan, stretches: Stretch[], wording: string): JoinedPiece {
  const last = stretches[stretches.length - 1];
  let coversLast = true;
  for (let i = last.end; i < part.map.length; i++) {
    const entry = part.map[i];
    if (isSynthetic(entry)) continue;
    if (entry.paragraphIndex !== last.paragraph) break;
    if (part.text[i].trim()) {
      coversLast = false;
      break;
    }
  }
  return { spans: stretches.map((s) => ({ ...span, start: s.start, end: s.end })), wording: flat(wording), coversLast };
}

const paragraphOf = (run: Element): Element | null => {
  for (let node = run.parentNode; node && node.nodeType === 1; node = node.parentNode) {
    if ((node as Element).nodeName === "w:p") return node as Element;
  }
  return null;
};

const STRUCK = new Set(["w:del", "w:moveFrom"]);
const MARK_REVISIONS = new Set(["w:ins", "w:del", "w:moveFrom", "w:moveTo"]);

/** A paragraph's own runs that still read in the contract, in order. A comment's anchor is left out. */
function liveRuns(p: Element): Element[] {
  const runs = p.getElementsByTagName("w:r");
  const out: Element[] = [];
  for (let i = 0; i < runs.length; i++) {
    const run = runs[i];
    if (paragraphOf(run) !== p || isCommentAnchor(run)) continue;
    if (revisionAncestors(run).some((el) => STRUCK.has(el.nodeName))) continue;
    out.push(run);
  }
  return out;
}

/** True when a paragraph's break can be deleted: no section ends on it, and nobody has tracked a change to it. */
function breakCanGo(p: Element): boolean {
  const pPr = childElements(p).find((c) => c.nodeName === "w:pPr");
  if (!pPr) return true;
  if (childElements(pPr).some((c) => c.nodeName === "w:sectPr")) return false;
  const rPr = childElements(pPr).find((c) => c.nodeName === "w:rPr");
  return !rPr || !childElements(rPr).some((c) => MARK_REVISIONS.has(c.nodeName));
}

/**
 * What a joined change strikes and which paragraph breaks it deletes, or null
 * when the paragraphs can't be joined safely. `covered` holds the runs the
 * quote covers in each paragraph.
 */
function joinTargets(piece: JoinedPiece, covered: Element[][]): { runs: Element[]; breaks: Element[] } | null {
  // Wording the property already struck sits inside the passage.
  if (covered.flat().some((run) => revisionAncestors(run).some((el) => STRUCK.has(el.nodeName)))) return null;

  const first = paragraphOf(covered[0][0]);
  const last = paragraphOf(covered[covered.length - 1][0]);
  if (!first || !last || first === last) return null;

  // Every paragraph from the first to the last, which must sit side by side.
  const chain: Element[] = [first];
  for (let node = first.nextSibling; chain[chain.length - 1] !== last; node = node.nextSibling) {
    if (!node) return null;
    if (node.nodeType !== 1) continue;
    if ((node as Element).nodeName !== "w:p") return null;
    chain.push(node as Element);
  }

  const runs: Element[] = [];
  for (const [index, p] of chain.entries()) {
    const live = liveRuns(p);
    if (index === 0) {
      const from = live.indexOf(covered[0][0]);
      if (from === -1) return null;
      runs.push(...live.slice(from));
    } else if (index === chain.length - 1 && !piece.coversLast) {
      const lastCovered = covered[covered.length - 1];
      const to = live.indexOf(lastCovered[lastCovered.length - 1]);
      if (to === -1) return null;
      runs.push(...live.slice(0, to + 1));
    } else {
      runs.push(...live);
    }
  }

  // The last paragraph's own break always stays. When it keeps wording, so does the break before it.
  const breaks = chain.slice(0, piece.coversLast ? -1 : -2);
  return breaks.every(breakCanGo) ? { runs, breaks } : null;
}

/**
 * Lays a proposal out across the paragraphs its quote covers.
 *
 * One tracked change cannot cross a paragraph break, so a change to wording in
 * two paragraphs is made as one change in each. The proposal is compared with
 * the paragraphs word by word, and each change goes to the paragraph it falls
 * inside. Null when a change straddles the break, as a rewrite does: guessing
 * there would put wording in the wrong paragraph.
 */
function paragraphPieces(part: WalkResult, span: LocatedSpan, proposal: string): ParagraphPiece[] | null {
  const stretches = stretchesIn(part, span);
  return stretches.length < 2 ? null : piecesFor(part, span, stretches, proposal);
}

/**
 * Lays a proposal out across the table cells its quote covers, so each cell
 * takes its own in-place change and the table stays where it is.
 *
 * The proposal is split per cell by the rule the table's copy uses. A cell
 * holding several paragraphs then has its piece laid across them, as
 * `paragraphPieces` does, or joined when it can't be.
 */
function cellPieces(part: WalkResult, span: LocatedSpan, proposal: string): Piece[] | { reason: string } {
  const cells: Stretch[][] = [];
  for (const stretch of stretchesIn(part, span)) {
    const last = cells[cells.length - 1];
    if (last && last[0].cell === stretch.cell) last.push(stretch);
    else cells.push([stretch]);
  }

  const laid = layOut(
    proposal,
    cells.map((cell) => cell.map((s) => part.text.slice(s.start, s.end)).join(" "))
  );
  if ("reason" in laid) return laid;

  const pieces: Piece[] = [];
  for (const [index, cell] of cells.entries()) {
    const inCell = piecesFor(part, span, cell, laid.pieces[index]);
    pieces.push(...(inCell ?? [joinedPiece(part, span, cell, laid.pieces[index])]));
  }
  return pieces;
}

/** Revision elements enclosing a run, outermost last. */
function revisionAncestors(run: Element): Element[] {
  const out: Element[] = [];
  let node: Node | null = run.parentNode;
  while (node && node.nodeType === 1) {
    const name = (node as Element).nodeName;
    if (name === "w:ins" || name === "w:del" || name === "w:moveFrom" || name === "w:moveTo") {
      out.push(node as Element);
    }
    node = node.parentNode;
  }
  return out;
}

export async function generateRedline({
  originalDocxBytes,
  findings,
  comments = new Map(),
  author,
  now = new Date(),
}: {
  originalDocxBytes: Uint8Array;
  findings: RevisionFinding[];
  /**
   * The comment for each finding, by id, from lib/redline-comments/assembly.ts.
   * The only source of comment text. A finding without an entry gets no comment.
   */
  comments?: ReadonlyMap<string, string>;
  author: string;
  now?: Date;
}): Promise<RedlineOutcome> {
  const pkg = await loadDocx(originalDocxBytes);
  const ids = new RevisionIds(pkg.textParts);
  const date = now.toISOString();

  const unapplied: UnappliedFinding[] = [];
  const unappliedIds: string[] = [];
  const widened: WidenedChange[] = [];
  const resolutions: Resolution[] = [];
  const editedParts = new Set<ParsedPart>();
  let appliedCount = 0;

  const refuse = (
    finding: RevisionFinding,
    reason: UnappliedReason,
    spanResolution: SpanResolution,
    applicability: Applicability,
    detail: string,
    more: Pick<Resolution, "conflictsWith" | "places"> = {}
  ) => {
    unapplied.push({
      clause_type: finding.clause_type,
      severity: finding.severity,
      quoted_text: finding.quoted_text,
      reason,
    });
    unappliedIds.push(finding.id);
    resolutions.push({ findingId: finding.id, spanResolution, applicability, detail, reason, ...more });
  };

  const locate = (parts: WalkResult[], finding: RevisionFinding) =>
    locateQuote(parts, finding.quoted_text, finding.location_section, finding.quote_context ?? null);

  // Where each applied finding's quote sat in the contract as it arrived, for naming the one a later finding overlaps.
  const placed: { findingId: string; part: string; start: number; end: number }[] = [];

  const freshWalk = () => {
    const numbering = new NumberingResolver(pkg.numbering, pkg.styles);
    return pkg.textParts.map((p) => walkPart(p, numbering));
  };

  // Re-walked whenever the document has changed under it, so a later finding
  // sees the contract as it now reads rather than as it arrived. The text and
  // map are snapshots, so the pristine one stays valid as the tree mutates.
  const pristine = freshWalk();
  let walked: WalkResult[] | null = pristine;
  const walk = () => (walked ??= freshWalk());

  // Clauses the contract does not have, appended together at the end (§1.5.8)
  // rather than one appendix per finding.
  const toAppend: { findingId: string; text: string }[] = [];

  // The copies of replaced tables. A later change to one of those tables is made in its copy.
  const tableCopies = new Set<Element>();

  // What each applied finding wrote, for anchoring its comment once every change is in.
  const written: { findingId: string; part: string; revisionIds: string[] }[] = [];

  // The contract as it arrived, for spotting wording a proposal repeats. A
  // proposal keeps any sentence another finding strikes, or the contract
  // would lose it altogether.
  const contractText = pristine.map((p) => p.text).join("\n");
  const struckByBatch = struckSentences(findings);

  const leavesOut = ({ dropped, reworded }: { dropped: string[]; reworded: string[] }) =>
    (dropped.length === 0
      ? ""
      : ` Leaves out ${dropped.length === 1 ? "a sentence" : `${dropped.length} sentences`} the contract already has.`) +
    reworded
      .map((s) => ` Leaves out one sentence ("${excerpt(s)}"), which rewords a sentence the contract already has that this change doesn't replace.`)
      .join("");

  const append = (finding: RevisionFinding) => {
    const problem = wordingProblem(finding.language, null);
    if (problem) {
      refuse(finding, problem.reason, "unresolved", "blocked_wording", problem.detail);
      return;
    }
    // Appending a rewrite of an existing clause would leave both versions in
    // the contract, contradicting each other.
    if (rewritesExistingWording(finding.language, contractText)) {
      refuse(
        finding,
        "unquoted_rewrite",
        "unresolved",
        "blocked_wording",
        "The proposal opens with wording already in the contract, and the finding quotes nothing for it to replace."
      );
      return;
    }
    const restated = dropRestated(finding.language.trim(), contractText, struckByBatch);
    const { language } = restated;
    if (!language.trim()) {
      refuse(finding, "missing_clause", "unresolved", "applicable", "The finding proposes no language to add.");
      return;
    }
    toAppend.push({ findingId: finding.id, text: language.trim() });
    appliedCount++;
    resolutions.push({
      findingId: finding.id,
      spanResolution: "unresolved",
      applicability: "applicable",
      detail: `Not in the contract — added to the appendix as a tracked insertion.${leavesOut(restated)}`,
      reason: null,
      wording: language.trim(),
    });
  };

  // The finding whose change a refused one ran into, kept for the refusal that follows.
  let collidedWith: string | undefined;

  // Runs this export has already marked up. Editing inside one would read as a change to a change.
  const touchesOurs = (runs: Element[]) => {
    const ours = new Set(ids.ownRevisionIds);
    for (const run of runs) {
      const id = revisionAncestors(run).map((el) => el.getAttribute("w:id") ?? "").find((v) => ours.has(v));
      if (id === undefined) continue;
      collidedWith = written.find((w) => w.revisionIds.includes(id))?.findingId;
      return true;
    }
    return false;
  };

  /**
   * Makes each changed piece in place. Every piece is checked before any is
   * changed, so a refusal leaves the wording as it was.
   */
  const changeInPlace = (part: WalkResult, pieces: Piece[]): "done" | "no_runs" | "overlaps" | "cannot_join" => {
    const changes = pieces
      .filter((p): p is ParagraphPiece => !isJoined(p) && p.changed)
      .map((p) => ({ ...p, covered: runsForSpan(part, p.span) }));
    const joins = pieces.filter(isJoined).map((piece) => ({ piece, covered: piece.spans.map((s) => runsForSpan(part, s)) }));

    const everyRun = [...changes.map((c) => c.covered), ...joins.flatMap((j) => j.covered)];
    if (everyRun.some((runs) => runs.length === 0)) return "no_runs";
    if (everyRun.some(touchesOurs)) return "overlaps";

    const targets = joins.map((j) => ({ wording: j.piece.wording, target: joinTargets(j.piece, j.covered) }));
    if (targets.some((t) => !t.target || touchesOurs(t.target.runs))) return "cannot_join";

    for (const change of changes) replaceSpan({ covered: change.covered, replacement: change.wording, author, date, ids });
    for (const { wording, target } of targets) {
      strikeAndInsert(target!.runs, wording, { author, date, ids });
      for (const p of target!.breaks) setParagraphMark(p, "w:del", ids, author, date);
    }
    return "done";
  };

  for (const finding of findings) {
    const issuedBefore = ids.ownRevisionIds.length;
    collidedWith = undefined;

    // A point raised without wording, such as a term outside the standards
    // library. Marking its quote against empty wording would strike it.
    if (!finding.language.trim()) {
      refuse(finding, "no_wording", "unresolved", "blocked_wording", "No wording was proposed for this point.");
      continue;
    }

    // A quote says where the change belongs, even on a finding marked missing.
    if (!finding.quoted_text) {
      append(finding);
      continue;
    }

    const parts = walk();
    const located = locate(parts, finding);
    if (!isLocated(located) && finding.is_missing_clause) {
      append(finding);
      continue;
    }
    if (!isLocated(located)) {
      // Wording that was there when the document arrived and is not there now
      // was struck by an earlier finding. Saying "could not be found" would be
      // true and useless; the associate needs to know which of their decisions
      // took precedence.
      const origin = appliedCount > 0 ? locate(pristine, finding) : null;
      if (origin && isLocated(origin)) {
        const other = placed.find((p) => p.part === origin.part && p.start < origin.end && origin.start < p.end);
        refuse(
          finding,
          "overlaps_another_change",
          "unresolved",
          "blocked_already_deleted",
          "Another finding already marks up overlapping wording.",
          { conflictsWith: other?.findingId }
        );
      } else {
        refuse(
          finding,
          located.ambiguous ? "ambiguous_quote" : "not_located",
          "unresolved",
          "blocked_cross_paragraph",
          located.reason,
          { places: located.places }
        );
      }
      continue;
    }

    const problem = wordingProblem(finding.language, finding.quoted_text);
    if (problem) {
      refuse(finding, problem.reason, located.resolution, "blocked_wording", problem.detail);
      continue;
    }

    const part = parts.find((p) => p.part === located.part)!;
    const fit = fitToProposal(part, located, finding.language);
    const { span } = fit;
    const restated = dropRestated(fit.language, contractText, [
      ...struckByBatch,
      part.text.slice(span.start, span.end),
    ]);
    const { language } = restated;
    const struck = fit.widened
      ? [fit.widened.before, fit.widened.after].map((s) => s.trim()).filter(Boolean).join(" … ")
      : "";

    // Recorded once the change is actually made, so the associate is asked to
    // check only wording the file really strikes. A change made inside an
    // insertion already there names that insertion for its comment.
    const applied = (detail: string, anchorIds?: string[]) => {
      appliedCount++;
      written.push({
        findingId: finding.id,
        part: span.part,
        revisionIds: anchorIds ?? ids.ownRevisionIds.slice(issuedBefore),
      });
      if (struck) {
        widened.push({ clause_type: finding.clause_type, severity: finding.severity, quoted_text: finding.quoted_text, struck });
      }
      resolutions.push({
        findingId: finding.id,
        spanResolution: span.resolution,
        applicability: "applicable",
        detail:
          (struck ? `${detail} Covers the whole sentence, so it also strikes: "${struck}".` : detail) + leavesOut(restated),
        reason: null,
        wording: language,
        alsoStrikes: struck || undefined,
      });
      const origin = locate(pristine, finding);
      if (isLocated(origin)) placed.push({ findingId: finding.id, part: origin.part, start: origin.start, end: origin.end });
    };

    const verdict = assessApplicability(part, span);
    if (verdict.applicability !== "applicable") {
      refuse(finding, verdict.reason ?? REASON_FOR[verdict.applicability], span.resolution, verdict.applicability, verdict.detail);
      continue;
    }

    // Every route below can split runs, even one that ends in a refusal, and a
    // split leaves the walk pointing at runs no longer in the document. The
    // next finding reads the document afresh.
    walked = null;

    // A table this export has already replaced takes every later change in its one copy.
    if (copyHolding(part, span, tableCopies)) {
      const edited = editCopy({ part, span, replacement: language, ownIds: new Set(ids.ownRevisionIds) });
      if (!edited.ok) {
        refuse(finding, "crosses_boundary", span.resolution, "blocked_table", edited.reason);
        continue;
      }
      editedParts.add(pkg.textParts.find((p) => p.name === span.part)!);
      applied("Made in the copy of the table this export already replaces.", edited.revisionIds);
      continue;
    }

    if (verdict.strategy === "across_cells") {
      const pieces = cellPieces(part, span, language);
      if (!("reason" in pieces) && changeInPlace(part, pieces) === "done") {
        editedParts.add(pkg.textParts.find((p) => p.name === span.part)!);
        applied(verdict.detail);
        continue;
      }

      // The change can't go in cell by cell, so the table is struck and an
      // edited copy inserted. The attempt above may have split runs, so the
      // document is read afresh.
      const fresh = freshWalk().find((p) => p.part === span.part)!;
      const replaced = replaceTable({ part: fresh, span, replacement: language, author, date, ids, copies: tableCopies });
      if (!replaced.ok) {
        refuse(finding, replaced.unapplied ?? "crosses_boundary", span.resolution, "blocked_table", replaced.reason);
        continue;
      }
      editedParts.add(pkg.textParts.find((p) => p.name === span.part)!);
      applied("The change can't be made one cell at a time, so the whole table is replaced as a tracked change.");
      continue;
    }

    if (verdict.strategy === "per_paragraph") {
      // One change per paragraph where the proposal can be laid out that way, and one joined change where it can't.
      const stretches = stretchesIn(part, span);
      const split = paragraphPieces(part, span, language);
      const pieces: Piece[] = split ?? (stretches.length > 1 ? [joinedPiece(part, span, stretches, language)] : []);

      const outcome = pieces.length ? changeInPlace(part, pieces) : "cannot_join";
      if (outcome === "cannot_join") {
        refuse(
          finding,
          "crosses_boundary",
          span.resolution,
          "blocked_cross_paragraph",
          "The wording runs across a paragraph break, and the paragraphs can't be joined into one change."
        );
        continue;
      }
      if (outcome === "no_runs") {
        refuse(finding, "not_located", span.resolution, "blocked_cross_paragraph", "The wording resolved to no editable runs.");
        continue;
      }
      if (outcome === "overlaps") {
        refuse(
          finding,
          "overlaps_another_change",
          span.resolution,
          "blocked_already_deleted",
          "Another finding already marks up overlapping wording.",
          { conflictsWith: collidedWith }
        );
        continue;
      }

      editedParts.add(pkg.textParts.find((p) => p.name === span.part)!);
      applied(split ? verdict.detail : "The wording runs across paragraphs, so it is replaced as one change and the paragraphs are joined.");
      continue;
    }

    const covered = runsForSpan(part, span);
    if (covered.length === 0) {
      refuse(finding, "not_located", span.resolution, "blocked_cross_paragraph", "The wording resolved to no editable runs.");
      continue;
    }

    // A finding whose wording overlaps one already marked up would nest an
    // edit inside our own, which reads as a change to a change. Refuse instead.
    if (touchesOurs(covered)) {
      refuse(
        finding,
        "overlaps_another_change",
        span.resolution,
        "blocked_already_deleted",
        "Another finding already marks up overlapping wording.",
        { conflictsWith: collidedWith }
      );
      continue;
    }

    replaceSpan({ covered, replacement: language, author, date, ids });
    editedParts.add(pkg.textParts.find((p) => p.name === span.part)!);
    applied(verdict.detail);
  }

  const anchors: CommentAnchor[] = [];

  if (toAppend.length) {
    const paragraphs = appendClauses({ part: pkg.document, clauses: toAppend.map((c) => c.text), author, date, ids });
    editedParts.add(pkg.document);
    toAppend.forEach(({ findingId }, i) => {
      const text = comments.get(findingId);
      if (text && paragraphs[i]) anchors.push({ changes: revisionsIn(paragraphs[i]), text });
    });
  }

  // Word has no comments in headers or footers, so a change there goes out without one.
  const inBody = revisionsById(pkg.document);
  for (const { findingId, part, revisionIds } of written) {
    const text = comments.get(findingId);
    if (!text?.trim()) continue;
    if (part !== pkg.document.name) {
      const resolution = resolutions.find((r) => r.findingId === findingId);
      if (resolution) resolution.detail += " Word doesn't allow comments in headers and footers, so this change has none.";
      continue;
    }
    const changes = revisionIds.map((id) => inBody.get(id)).filter((el): el is Element => !!el);
    anchors.push({ changes, text });
  }

  const { ownCommentIds, createdCommentsPart } = await writeComments({
    zip: pkg.zip,
    document: pkg.document,
    anchors,
    author,
    date,
    firstId: ids.nextFree,
  });
  if (ownCommentIds.length) editedParts.add(pkg.document);

  for (const part of editedParts) pkg.zip.file(part.path, serializePart(part));
  const docxBytes = await pkg.zip.generateAsync({ type: "uint8array" });

  return {
    docxBytes,
    appliedCount,
    unapplied,
    widened,
    ownRevisionIds: ids.ownRevisionIds,
    ownCommentIds,
    createdCommentsPart,
    resolutions,
    unappliedIds,
  };
}
