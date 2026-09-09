import type { RenderedLine } from "./text-to-pdf";
import { textToPdf } from "./text-to-pdf";
import { extractPdfLines } from "./extract-pdf-lines";
import { locateQuote } from "./redline-engine/locate";
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

/** Baselines within this many points are the same visual line. */
const BASELINE_EPSILON = 2;

/** Repeating furniture must appear on at least this share of pages. */
const FURNITURE_PAGE_SHARE = 0.6;

/** Below this page count, "repeats on most pages" means nothing. */
const FURNITURE_MIN_PAGES = 3;

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

  // Key on text plus rounded height so the same words at the same height on
  // many pages group together; body text that happens to recur will not also
  // share a y.
  const seen = new Map<string, Set<number>>();
  for (const l of lines) {
    const key = `${norm(l.text)}@${Math.round(l.y / 4)}`;
    if (!norm(l.text)) continue;
    if (!seen.has(key)) seen.set(key, new Set());
    seen.get(key)!.add(l.pageIndex);
  }

  const furniture = new Set(
    [...seen.entries()].filter(([, pages]) => pages.size >= pageCount * FURNITURE_PAGE_SHARE).map(([key]) => key)
  );
  if (furniture.size === 0) return lines;

  return lines.filter((l) => !furniture.has(`${norm(l.text)}@${Math.round(l.y / 4)}`));
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
  const lines = dropRunningFurniture(sortToReadingOrder(rawLines));
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
  const gapCounts = new Map<number, number>();
  for (const g of gaps) {
    const k = Math.round(g);
    gapCounts.set(k, (gapCounts.get(k) ?? 0) + 1);
  }
  let pitch = Infinity;
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
  return out;
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
    out = out.slice(0, p.start) + p.finding.language + out.slice(p.end);
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

  // 3. Round trip: read the rendered PDF back and confirm nothing was lost at
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
