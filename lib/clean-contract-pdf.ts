import type { RenderedLine } from "./text-to-pdf";
import { textToPdf } from "./text-to-pdf";
import { extractPdfLines } from "./extract-pdf-lines";
import { locateQuote } from "./redline-engine/locate";
import { normalizeText } from "./docx/normalize";
import { isLocated } from "./redline-engine/types";

/**
 * §1.7.7 — the contract as it would read if the property agreed to every
 * accepted change. The marked-up PDF shows what changed; this shows the
 * result, with the proposed language already in place and no strikethroughs
 * or margin markers.
 *
 * Text comes from the same positioned lines the marked-up PDF uses
 * (lib/get-positioned-lines.ts) and spans are found by §1.5's locator, so the
 * two exports cannot disagree about where a finding sits.
 *
 * Layout fidelity is explicitly not a goal (user's call, 2026-09-09) — spacing
 * and wrapping will differ from the source. What must hold is that no content
 * is missing and none is present that should not be, which is what
 * checkContentConservation enforces.
 *
 * This is the third document that can reach the property, after the redline
 * and the property email. CleanContractFinding therefore carries contract text
 * only. Severity, finding_text and cd_standard are CD's negotiating leverage
 * and cannot reach it, the same rule §1.8.3 applies to the property email.
 */

/** Every field allowed into a property-facing document. No severity, no rationale. */
export interface CleanContractFinding {
  clause_type: string;
  location_section: string | null;
  quoted_text: string | null;
  language: string;
  is_missing_clause: boolean;
}

export interface UnplacedChange {
  clause_type: string;
  language: string;
  reason: string;
}

export interface ConservationReport {
  ok: boolean;
  problems: string[];
}

export interface CleanContractResult {
  pdfBytes: Uint8Array;
  appliedCount: number;
  additions: CleanContractFinding[];
  unplaced: UnplacedChange[];
  conservation: ConservationReport;
}

const ADDITIONS_HEADING = "Additional Proposed Clauses";
const UNPLACED_HEADING = "Proposed Changes Not Placed Automatically";

const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();

/**
 * Letters and digits only.
 *
 * Comparison has to survive two things. Text extraction merges adjacent lines
 * without a separator, so word boundaries at line ends are not reliable; and
 * lib/text-to-pdf.ts substitutes or drops glyphs its font cannot encode. Both
 * disappear at this granularity, and a real dropped or reordered character
 * still shows.
 */
function alnum(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * A letter or digit the renderer's font cannot encode. lib/text-to-pdf.ts drops
 * those rather than crashing, and the check below compares letters and digits
 * only, so such a character is stripped from both sides and the loss goes
 * unseen. Symbols are excluded deliberately — an en dash sits above this range
 * and encodes fine.
 */
const UNENCODABLE_LETTER = /[^\x00-\xFF]/u;

/** Page numbers are drawn by the renderer, not part of the document's content. */
const PAGE_NUMBER = /^page\s+\d+\s+of\s+\d+$/i;

const titleCase = (s: string) => s.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());

/**
 * Reading order, not content-stream order. unpdf returns items in whatever
 * order the PDF's internals store them, which departs from what a person reads
 * in multi-column and table layouts (see lib/extract-pdf-lines.ts). y is
 * bottom-origin, so descending y runs down the page.
 *
 * DOCX-sourced lines are already in this order, so sorting is a no-op there
 * and both formats can share one path.
 */
function sortToReadingOrder(lines: RenderedLine[]): RenderedLine[] {
  return [...lines].sort((a, b) => {
    if (a.pageIndex !== b.pageIndex) return a.pageIndex - b.pageIndex;
    if (Math.abs(a.y - b.y) > BASELINE_EPSILON) return b.y - a.y;
    return a.x - b.x;
  });
}

/**
 * Baselines this close are the same visual line. Wide enough that a footnote
 * marker or superscript joins the line it belongs to rather than sorting ahead
 * of it, and well under a normal line pitch so separate lines stay separate.
 */
const BASELINE_EPSILON = 5;

/** Repeating furniture must appear on at least this share of pages. */
const FURNITURE_PAGE_SHARE = 0.6;

/** Below this page count, "repeats on most pages" means nothing. */
const FURNITURE_MIN_PAGES = 3;

/** Below this many lines on a page, first and last mean nothing. */
const FURNITURE_MIN_LINES_PER_PAGE = 4;

/**
 * Longer than this and it is a sentence, not a running head. Masking digits is
 * what makes "Page 1 of 40" and "Page 2 of 40" the same footer, and this stops
 * that from also matching body lines that differ only by a clause number.
 */
const FURNITURE_MAX_CHARS = 60;

/**
 * Drops running headers and footers. Body text does not repeat verbatim at the
 * same height on most pages; page numbers and letterhead do. Re-rendering them
 * inline would strand "Page 3 of 40" in the middle of a sentence.
 *
 * A no-op for DOCX-sourced lines, where lib/text-to-pdf.ts draws page numbers
 * outside the returned line data.
 */
function dropRunningFurniture(lines: RenderedLine[]): RenderedLine[] {
  const pageCount = new Set(lines.map((l) => l.pageIndex)).size;
  if (pageCount < FURNITURE_MIN_PAGES) return lines;

  // Key on the text with digits masked, plus a rounded height. "Page 1 of 40"
  // and "Page 2 of 40" are the same footer and have to group together, while
  // body text that happens to recur will not also share a y.
  const key = (l: RenderedLine) => `${norm(l.text).replace(/\d+/g, "#")}@${Math.round(l.y / 4)}`;

  // Repetition alone is not enough. Masking digits makes "Page 1 of 40" and
  // "Page 2 of 40" match, but it would also match body lines differing only by
  // a number, so a candidate must also be the first or last line on its page.
  // That is what a running header or footer is, and it needs no threshold on a
  // page height the line data does not carry.
  const edges = new Map<number, { top: number; bottom: number; count: number }>();
  for (const l of lines) {
    const e = edges.get(l.pageIndex);
    if (!e) edges.set(l.pageIndex, { top: l.y, bottom: l.y, count: 1 });
    else {
      e.top = Math.max(e.top, l.y);
      e.bottom = Math.min(e.bottom, l.y);
      e.count += 1;
    }
  }

  const atEdge = (l: RenderedLine) => {
    const e = edges.get(l.pageIndex);
    if (!e || e.count < FURNITURE_MIN_LINES_PER_PAGE) return false;
    return l.y >= e.top - BASELINE_EPSILON || l.y <= e.bottom + BASELINE_EPSILON;
  };

  const seen = new Map<string, Set<number>>();
  for (const l of lines) {
    if (!norm(l.text) || norm(l.text).length > FURNITURE_MAX_CHARS || !atEdge(l)) continue;
    if (!seen.has(key(l))) seen.set(key(l), new Set());
    seen.get(key(l))!.add(l.pageIndex);
  }

  const furniture = new Set(
    [...seen.entries()].filter(([, pages]) => pages.size >= pageCount * FURNITURE_PAGE_SHARE).map(([k]) => k)
  );
  if (furniture.size === 0) return lines;

  // A table continuing across pages repeats its header row at the top of each
  // one, which looks exactly like a running head. The two are told apart by
  // whether the digits move: "Page 1 of 40" varies and is certainly furniture,
  // while an unchanging line could be either. So an unchanging line keeps its
  // first occurrence, which is the right answer for a table header and merely
  // untidy for a document title. Losing a table header is content loss, and
  // that is the error worth avoiding.
  const varies = new Map<string, boolean>();
  const firstText = new Map<string, string>();
  for (const l of lines) {
    const k = key(l);
    if (!furniture.has(k) || !atEdge(l)) continue;
    const seenText = firstText.get(k);
    if (seenText === undefined) firstText.set(k, norm(l.text));
    else if (seenText !== norm(l.text)) varies.set(k, true);
  }

  const kept = new Set<string>();
  return lines.filter((l) => {
    const k = key(l);
    if (!atEdge(l) || !furniture.has(k)) return true;
    if (varies.get(k)) return false;
    if (kept.has(k)) return false;
    kept.add(k);
    return true;
  });
}

/** A gap wider than the running line pitch by this factor starts a new paragraph. */
const PARAGRAPH_GAP_FACTOR = 1.4;

/**
 * Rebuilds the contract text from positioned lines. Items sharing a baseline
 * join into one line; a vertical gap wider than the document's own line pitch,
 * or a page change, starts a new paragraph.
 *
 * The pitch is measured from the document rather than assumed, because the two
 * sources differ — lib/text-to-pdf.ts uses a fixed 14pt, a genuine PDF uses
 * whatever it was typeset at.
 */
export function reconstructContractText(rawLines: RenderedLine[]): string {
  const lines = dropRunningFurniture(sortToReadingOrder(rawLines.filter((l) => l.text.trim())));
  if (lines.length === 0) return "";

  // Group into visual lines.
  const groups: { pageIndex: number; y: number; text: string }[] = [];
  for (const l of lines) {
    const prev = groups[groups.length - 1];
    if (prev && prev.pageIndex === l.pageIndex && Math.abs(prev.y - l.y) <= BASELINE_EPSILON) {
      prev.text += (prev.text.endsWith(" ") || l.text.startsWith(" ") ? "" : " ") + l.text.trim();
    } else {
      groups.push({ pageIndex: l.pageIndex, y: l.y, text: l.text.trim() });
    }
  }

  const gaps: number[] = [];
  for (let i = 1; i < groups.length; i++) {
    if (groups[i].pageIndex !== groups[i - 1].pageIndex) continue;
    const gap = groups[i - 1].y - groups[i].y;
    if (gap > 0) gaps.push(gap);
  }
  // The most common gap is the line pitch in any normally set document. The
  // median would drift upward in a contract of mostly single-line paragraphs
  // and stop detecting breaks at all.
  //
  // Only gaps that could plausibly be a line pitch are counted. A page holding
  // two lines far apart otherwise makes that whole distance look like the
  // document's normal spacing, and every paragraph break disappears.
  const heights = lines.map((l) => l.height).sort((a, b) => a - b);
  const medianHeight = heights[Math.floor(heights.length / 2)] || 14;
  const plausible = gaps.filter((g) => g <= medianHeight * 3);

  const gapCounts = new Map<number, number>();
  for (const g of plausible) {
    const k = Math.round(g);
    gapCounts.set(k, (gapCounts.get(k) ?? 0) + 1);
  }
  let pitch = medianHeight;
  let best = 0;
  for (const [gap, count] of gapCounts) {
    if (count > best || (count === best && gap < pitch)) {
      best = count;
      pitch = gap;
    }
  }

  let out = groups[0].text;
  for (let i = 1; i < groups.length; i++) {
    const samePage = groups[i].pageIndex === groups[i - 1].pageIndex;
    const gap = groups[i - 1].y - groups[i].y;
    const newParagraph = !samePage || gap > pitch * PARAGRAPH_GAP_FACTOR;
    out += (newParagraph ? "\n\n" : " ") + groups[i].text;
  }

  // lib/docx/normalize.ts states the rule: text and quote must normalise the
  // same way or a quoted phrase will not be found in the text it came from.
  // §1.5 gets text that §1.4 already normalised character by character while
  // building its source map. Reconstructed text has had no such pass, so it
  // gets one here — otherwise a contract written in Word, where curly quotes
  // and non-breaking hyphens are everywhere, silently fails to match.
  //
  // Normalising the whole string is safe here because this render is a new
  // document rather than an edit to an existing one, so no offset map has to
  // survive. Straight quotes for curly is a typographic change, which the
  // agreed bar allows; the removed characters are invisible to a reader.
  return normalizeText(out);
}

interface Placement {
  finding: CleanContractFinding;
  start: number;
  end: number;
}

export interface SubstitutionResult {
  text: string;
  applied: CleanContractFinding[];
  unplaced: UnplacedChange[];
  additions: CleanContractFinding[];
}

/**
 * Substitutes each accepted change into the contract text.
 *
 * Locating reuses §1.5's locateQuote rather than a second matcher: it tolerates
 * a rewrapped or recapitalised quote, disambiguates repeats by the finding's
 * section reference, and **refuses when it cannot tell two clauses apart**.
 * Refusing is the point — redlining nothing is recoverable, rewriting the wrong
 * clause goes to a hotel.
 *
 * Spans are resolved against the original text and applied right-to-left, so
 * earlier offsets stay valid as the text changes under them.
 */
export function applyProposedChanges(text: string, findings: CleanContractFinding[]): SubstitutionResult {
  const parts = [{ part: "contract", text }];
  const additions: CleanContractFinding[] = [];
  const unplaced: UnplacedChange[] = [];
  const placements: Placement[] = [];

  for (const finding of findings) {
    if (finding.is_missing_clause) {
      additions.push(finding);
      continue;
    }
    const result = locateQuote(parts, finding.quoted_text, finding.location_section);
    if (isLocated(result)) {
      placements.push({ finding, start: result.start, end: result.end });
    } else {
      unplaced.push({
        clause_type: finding.clause_type,
        language: finding.language,
        reason: result.reason ?? "The quoted wording could not be found in the document.",
      });
    }
  }

  // Two findings resolving to overlapping text cannot both be applied, and
  // splicing them anyway would interleave two clauses into nonsense.
  placements.sort((a, b) => a.start - b.start);
  const kept: Placement[] = [];
  for (const p of placements) {
    const prev = kept[kept.length - 1];
    if (prev && p.start < prev.end) {
      unplaced.push({
        clause_type: p.finding.clause_type,
        language: p.finding.language,
        reason: `The quoted wording overlaps the text already replaced for ${titleCase(prev.finding.clause_type)}.`,
      });
    } else {
      kept.push(p);
    }
  }

  let out = text;
  for (const p of [...kept].reverse()) {
    const start = p.start;
    let end = p.end;

    // Deleting a clause leaves the spaces that sat either side of it. The
    // locator trims a model-supplied quote, so the span never covers them.
    if (p.finding.language === "" && out[start - 1] === " " && out[end] === " ") end += 1;

    out = out.slice(0, start) + p.finding.language + out.slice(end);
  }

  return { text: out, applied: kept.map((p) => p.finding), unplaced, additions };
}

/** Body plus the two closing sections, each omitted when it has nothing to say. */
export function buildCleanContractText(result: SubstitutionResult): string {
  let out = result.text;

  if (result.additions.length) {
    out += `\n\n${ADDITIONS_HEADING}\n\n`;
    out += result.additions.map((a) => `${titleCase(a.clause_type)}\n${a.language}`).join("\n\n");
  }

  if (result.unplaced.length) {
    out += `\n\n${UNPLACED_HEADING}\n\n`;
    out += "The wording below is proposed for the clauses named, but the text it replaces could not be identified automatically. The body above is unchanged for these items.\n\n";
    out += result.unplaced.map((u) => `${titleCase(u.clause_type)}\n${u.language}`).join("\n\n");
  }

  return out;
}

/**
 * Applies the same spans left-to-right, accumulating output rather than
 * splicing in reverse. A second implementation of the same operation, used
 * only as an oracle — if the two disagree, an offset is wrong, which is the
 * silent corruption §1.4 and §1.5 are most careful about.
 */
function applyForward(text: string, placements: { start: number; end: number; language: string }[]): string {
  let out = "";
  let cursor = 0;
  for (const p of [...placements].sort((a, b) => a.start - b.start)) {
    out += text.slice(cursor, p.start) + p.language;
    cursor = p.end;
  }
  return out + text.slice(cursor);
}

/** Where two character streams first diverge, with context for the message. */
function firstDivergence(expected: string, actual: string): { at: number; context: string } | null {
  const limit = Math.min(expected.length, actual.length);
  for (let i = 0; i < limit; i++) {
    if (expected[i] !== actual[i]) {
      return { at: i, context: expected.slice(Math.max(0, i - 30), i + 30) };
    }
  }
  if (expected.length !== actual.length) {
    return { at: limit, context: expected.slice(Math.max(0, limit - 30), limit + 30) };
  }
  return null;
}

/**
 * The quality gate. Checks content, not layout — spacing and wrapping are
 * expected to differ from the source (user's call, 2026-09-09). What it
 * enforces is that nothing that should be in the document is missing.
 *
 * Runs for every source format. It passes trivially for DOCX/DOC, where the
 * text was rendered from our own flowed output; it earns its keep on genuine
 * PDFs, where extraction returns fragments whose order reflects the file's
 * content stream rather than reading order.
 */
export async function checkContentConservation({
  originalText,
  intendedText,
  placements,
  applied,
  pdfBytes,
  title,
}: {
  originalText: string;
  intendedText: string;
  title: string;
  placements: { start: number; end: number; language: string }[];
  applied: CleanContractFinding[];
  pdfBytes: Uint8Array;
}): Promise<ConservationReport> {
  const problems: string[] = [];

  // 1. Two independent splice implementations must agree.
  const forward = applyForward(originalText, placements);
  const reverseBody = intendedText.split(`\n\n${ADDITIONS_HEADING}`)[0].split(`\n\n${UNPLACED_HEADING}`)[0];
  if (norm(forward) !== norm(reverseBody)) {
    problems.push("Applying the changes forwards and backwards produced different text, so an offset is wrong.");
  }

  // 2. Every change that reported as applied is actually in the text.
  for (const f of applied) {
    if (!norm(intendedText).includes(norm(f.language))) {
      problems.push(`The proposed language for ${titleCase(f.clause_type)} is not present in the output.`);
    }
  }

  // 3. Characters the font cannot encode are dropped at render time, and the
  //    comparison below would not see it because it ignores anything that is
  //    not a letter or digit.
  const unencodable = [...intendedText].filter(
    (ch) => UNENCODABLE_LETTER.test(ch) && /\p{L}|\p{N}/u.test(ch)
  );
  if (unencodable.length) {
    const sample = [...new Set(unencodable)].slice(0, 5).join(" ");
    problems.push(
      `The document contains ${unencodable.length} character(s) the PDF font cannot render, which would be ` +
        `dropped silently: ${sample}`
    );
  }

  // 4. Round trip: read the rendered PDF back and confirm nothing was lost at
  //    render time — an unencodable glyph dropped, or a page truncated.
  try {
    const roundTripped = await extractPdfLines(pdfBytes.slice());
    const actual = alnum(
      sortToReadingOrder(roundTripped)
        .filter((l) => !PAGE_NUMBER.test(l.text.trim()))
        .map((l) => l.text)
        .join(" ")
    );
    const expected = alnum(`${title}${intendedText}`);
    const divergence = firstDivergence(expected, actual);
    if (divergence) {
      problems.push(
        `The rendered PDF does not match the document it was built from, first differing around ` +
          `"...${divergence.context}...".`
      );
    }
  } catch (err) {
    problems.push(`The rendered PDF could not be read back for checking: ${err instanceof Error ? err.message : err}`);
  }

  return { ok: problems.length === 0, problems };
}

/**
 * The whole pipeline: reconstruct, substitute, render, check.
 *
 * The caller decides what to do with a failed conservation report — the route
 * refuses the download rather than handing over a document that looks finished
 * and is not (§1.6.4's pattern).
 */
export async function generateCleanContractPdf({
  lines,
  findings,
  title,
}: {
  lines: RenderedLine[];
  findings: CleanContractFinding[];
  title: string;
}): Promise<CleanContractResult> {
  const originalText = reconstructContractText(lines);
  const substitution = applyProposedChanges(originalText, findings);
  const intendedText = buildCleanContractText(substitution);

  const { pdfBytes } = await textToPdf(title, intendedText);

  // Re-derive the spans the substitution used, for the forward/reverse oracle.
  const parts = [{ part: "contract", text: originalText }];
  const placements: { start: number; end: number; language: string }[] = [];
  for (const f of substitution.applied) {
    const r = locateQuote(parts, f.quoted_text, f.location_section);
    if (isLocated(r)) placements.push({ start: r.start, end: r.end, language: f.language });
  }

  const conservation = await checkContentConservation({
    originalText,
    intendedText,
    placements,
    applied: substitution.applied,
    pdfBytes,
    title,
  });

  return {
    pdfBytes,
    appliedCount: substitution.applied.length,
    additions: substitution.additions,
    unplaced: substitution.unplaced,
    conservation,
  };
}
