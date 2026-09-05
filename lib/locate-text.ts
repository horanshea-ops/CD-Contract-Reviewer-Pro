import type { RenderedLine } from "./text-to-pdf";

/**
 * Finds which positioned lines (or PDF text items — see lib/extract-pdf-lines.ts)
 * a piece of quoted text corresponds to, tolerating whitespace differences.
 * Shared by the marked-up-PDF export (lib/redline-pdf.ts) and analysis-time
 * location persistence (lib/analysis-pipeline.ts), so both agree on what
 * "locatable" means.
 */

function normalize(s: string): string {
  return s.replace(/\s+/g, " ").trim().toLowerCase();
}

export function findMatchingLineIndices(lines: RenderedLine[], quotedText: string): number[] | null {
  const normalizedQuoted = normalize(quotedText);
  if (!normalizedQuoted) return null;

  let concatenated = "";
  const lineStarts: number[] = [];
  for (const line of lines) {
    lineStarts.push(concatenated.length);
    concatenated += normalize(line.text) + " ";
  }

  const idx = concatenated.indexOf(normalizedQuoted);
  if (idx === -1) return null;
  const end = idx + normalizedQuoted.length;

  const matched: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    const start = lineStarts[i];
    const stop = i + 1 < lines.length ? lineStarts[i + 1] : concatenated.length;
    if (start < end && stop > idx) matched.push(i);
  }
  return matched.length ? matched : null;
}

export interface HighlightRect {
  pageIndex: number; // 0-based, matches RenderedLine.pageIndex
  x: number;
  y: number; // box BOTTOM edge, PDF point space (not a baseline)
  width: number;
  height: number;
}

// First-pass estimates: RenderedLine.y is a text baseline, and .height means a
// fixed line-pitch constant for DOCX/DOC-generated PDFs (lib/text-to-pdf.ts)
// but a measured glyph bounding-box height for genuine PDFs (lib/extract-pdf-lines.ts,
// via unpdf) — the same proportional padding applied to two different underlying
// quantities is a judgment call, tuned by eye against real rendered output rather
// than derived exactly.
const TOP_FRACTION = 0.65; // of line.height, above the baseline
const BOTTOM_FRACTION = 0.2; // of line.height, below the baseline (descender allowance)
const Y_EPSILON = 1.0; // points; baselines within this count as "the same visual line"
const MAX_MERGE_GAP = 24; // points; don't bridge a horizontal gap wider than this —
// guards against merging across separate table cells/columns that happen to share a baseline y

/**
 * Like findMatchingLineIndices, but returns drawable highlight boxes instead
 * of raw line indices — for the in-app PDF viewer's highlight overlay, not the
 * export-time strikethrough drawing in lib/redline-pdf.ts (which draws one
 * segment per matched item with no merging, fine for a 1px line but not for a
 * filled box, where unmerged adjacent words would show visible gaps).
 * Adjacent matched items are merged into one rect only when they share a page
 * and a near-identical baseline y *and* a bounded horizontal gap, so two items
 * that happen to share a y (e.g. two cells in the same table row) don't get
 * bridged into a single box spanning unrelated content.
 */
export function findHighlightRects(lines: RenderedLine[], quotedText: string): HighlightRect[] | null {
  const matchedIndices = findMatchingLineIndices(lines, quotedText);
  if (!matchedIndices) return null;

  const rects: HighlightRect[] = [];
  for (const idx of matchedIndices) {
    const line = lines[idx];
    const top = line.y + line.height * TOP_FRACTION;
    const bottom = line.y - line.height * BOTTOM_FRACTION;
    const candidate: HighlightRect = {
      pageIndex: line.pageIndex,
      x: line.x,
      y: bottom,
      width: line.width,
      height: top - bottom,
    };

    const prev = rects[rects.length - 1];
    const sameLine = !!prev && prev.pageIndex === candidate.pageIndex && Math.abs(prev.y - candidate.y) < Y_EPSILON;
    const gap = sameLine ? candidate.x - (prev.x + prev.width) : Infinity;

    if (prev && sameLine && gap < MAX_MERGE_GAP) {
      const newRight = Math.max(prev.x + prev.width, candidate.x + candidate.width);
      prev.width = newRight - prev.x;
      prev.height = Math.max(prev.height, candidate.height);
    } else {
      rects.push(candidate);
    }
  }
  return rects.length ? rects : null;
}
