import {
  collapseWhitespace,
  normalizeChar,
  normalizeText,
  type ExtractedDocument,
  type ExtractedPart,
  type MarkupSpan,
  type RevisionInfo,
} from "./docx";

/**
 * Turns one part's tagged markup (MASTER_PLAN.md §1.4.3's "everything, tagged,
 * for display" view) into blocks a web page can render, for MASTER_PLAN.md
 * §1.4a — the HTML preview that replaces the flattened-PDF preview for
 * docx_native analyses.
 *
 * `markup` is built in the same traversal as `text`/`map` (see the `Sink`
 * class in lib/docx/walk.ts), in the same order, but is a strict superset: it
 * also carries deleted/moveFrom spans that `text` excludes. A span occupies
 * real offset space in `text` (and so is "accepted") exactly when
 * `span.revision === null` or `span.revision.kind` is `"ins"`/`"moveTo"` —
 * the same rule walk.ts's own `REVISION_VIEWS` table uses. Walking `markup`
 * in order and advancing a counter by `span.text.length` only for accepted
 * spans reproduces the exact `[start,end)` each accepted span occupies in
 * `text`, without ever touching `map` (whose synthetic entries carry no
 * structural flags anyway).
 *
 * Every literal string `Sink.synthetic()` is ever called with is one of a
 * small closed set (see CONTROL below); anything synthetic that isn't one of
 * those literals can only be a heading prefix or a resolved list marker —
 * the only other thing `paragraphPrefix()` in walk.ts produces. That gives an
 * unambiguous, context-free way to invert the emission, except for a bare
 * "\n" (an inline `w:br` vs. a table boundary), which is disambiguated by
 * *position* in the grammar below rather than content: a table boundary is
 * only ever tested at a block boundary, never from inside a paragraph's own
 * content loop.
 */

export interface PreviewRun {
  text: string;
  revision: RevisionInfo | null;
  /** [start, end) in this part's `text` coordinate space. Null for del/moveFrom spans — not in the accepted view. */
  range: { start: number; end: number } | null;
  /** "break" renders as <br/> (an inline w:br); everything else renders literally. */
  kind: "text" | "break";
}

export type PreviewBlock =
  | { kind: "heading"; level: 1 | 2 | 3 | 4 | 5 | 6; runs: PreviewRun[] }
  | { kind: "list-item"; indent: number; marker: string; runs: PreviewRun[] }
  | { kind: "paragraph"; runs: PreviewRun[] }
  | { kind: "table"; rows: PreviewRow[] };

export interface PreviewRow {
  cells: PreviewCell[];
}
export interface PreviewCell {
  blocks: PreviewBlock[];
}

export interface PreviewPart {
  part: string;
  text: string;
  blocks: PreviewBlock[];
}

const CONTROL = new Set(["\t", "\n", "-", " ", "\n\n", "|", " |", " --- |"]);
const HEADING_RE = /^#{1,6} $/;

function isAccepted(span: MarkupSpan): boolean {
  return span.revision === null || span.revision.kind === "ins" || span.revision.kind === "moveTo";
}

class Cursor {
  private i = 0;
  private offset = 0;

  constructor(private spans: MarkupSpan[]) {}

  get done() {
    return this.i >= this.spans.length;
  }

  private peekSpan(): MarkupSpan | undefined {
    return this.spans[this.i];
  }

  /** True if the next span is exactly this synthetic literal. */
  isNext(literal: string): boolean {
    const s = this.peekSpan();
    return !!s && s.synthetic && s.text === literal;
  }

  /** True if the next span is synthetic and not one of the fixed control literals. */
  isPrefixCandidate(): boolean {
    const s = this.peekSpan();
    return !!s && s.synthetic && !CONTROL.has(s.text);
  }

  /** Consumes the current span, advancing the offset counter iff it's accepted. */
  take(): PreviewRun {
    const s = this.spans[this.i++];
    let range: { start: number; end: number } | null = null;
    if (isAccepted(s)) {
      range = { start: this.offset, end: this.offset + s.text.length };
      this.offset += s.text.length;
    }
    return {
      text: s.text,
      revision: s.revision,
      range,
      kind: s.synthetic && s.text === "\n" ? "break" : "text",
    };
  }

  /** Consumes the current span for its offset effect only, discarding the content. */
  skip() {
    this.take();
  }
}

function parsePrefix(text: string): { level: number } | { marker: string; indent: number } {
  const heading = HEADING_RE.exec(text);
  if (heading) return { level: heading[0].length - 1 };
  const indentMatch = /^(?: {2})*/.exec(text);
  const indent = indentMatch ? indentMatch[0].length / 2 : 0;
  return { marker: text.slice(indentMatch?.[0].length ?? 0).trimEnd(), indent };
}

function parseParagraph(cur: Cursor, inCell: boolean): PreviewBlock {
  let heading: number | null = null;
  let listItem: { marker: string; indent: number } | null = null;

  if (cur.isPrefixCandidate()) {
    const prefix = cur.take();
    const parsed = parsePrefix(prefix.text);
    if ("level" in parsed) heading = parsed.level;
    else listItem = parsed;
  }

  const terminator = inCell ? " " : "\n\n";
  const runs: PreviewRun[] = [];
  while (!cur.done && !cur.isNext(terminator)) {
    runs.push(cur.take());
  }
  if (cur.isNext(terminator)) cur.skip();

  if (heading != null) return { kind: "heading", level: heading as 1 | 2 | 3 | 4 | 5 | 6, runs };
  if (listItem) return { kind: "list-item", indent: listItem.indent, marker: listItem.marker, runs };
  return { kind: "paragraph", runs };
}

function parseTable(cur: Cursor): PreviewBlock {
  cur.skip(); // opening blank line
  const rows: PreviewRow[] = [];

  while (cur.isNext("|")) {
    cur.skip(); // row-leading "|"

    if (cur.isNext(" --- |")) {
      while (cur.isNext(" --- |")) cur.skip();
      if (cur.isNext("\n")) cur.skip();
      continue; // separator row: consumed for offset accounting, not rendered
    }

    const cells: PreviewCell[] = [];
    while (cur.isNext(" ")) {
      cur.skip(); // cell-opening space
      const blocks = parseBlocks(cur, true, () => cur.isNext(" |"));
      if (cur.isNext(" |")) cur.skip();
      cells.push({ blocks });
    }
    rows.push({ cells });
    if (cur.isNext("\n")) cur.skip();
  }

  if (cur.isNext("\n")) cur.skip(); // closing blank line

  return { kind: "table", rows };
}

function parseBlocks(cur: Cursor, inCell: boolean, stop?: () => boolean): PreviewBlock[] {
  const blocks: PreviewBlock[] = [];
  while (!cur.done && !(stop && stop())) {
    if (cur.isNext("\n")) blocks.push(parseTable(cur));
    else blocks.push(parseParagraph(cur, inCell));
  }
  return blocks;
}

export function buildPartPreview(part: ExtractedPart): PreviewBlock[] {
  return parseBlocks(new Cursor(part.markup), false);
}

export function buildPreview(extracted: ExtractedDocument): PreviewPart[] {
  return extracted.parts.map((p) => ({ part: p.part, text: p.text, blocks: buildPartPreview(p) }));
}

export interface PreviewMatch {
  part: string;
  start: number;
  end: number;
  tier: "exact" | "normalized" | "flattened";
}

/**
 * Resolves a finding's quoted text to an exact offset range in one part's
 * `text`, for the preview's highlight — deliberately without §1.5.1's fuzzy
 * tier: this is a preview convenience, not the real span-resolution engine,
 * so a miss degrades to `null` (no highlight), the same UX as today's
 * "location not pinpointed" for PDFs.
 *
 * Three tiers, tried in order:
 *  1. exact substring
 *  2. whitespace/case-normalized substring
 *  3. "flattened" — against the already-*parsed* blocks rather than raw text.
 *     A model asked to quote a table clause routinely flattens it to
 *     "cell | cell | cell | cell", the way it read the table in the prompt —
 *     but the accepted-view text has our own markdown-style separator row
 *     (`| --- | --- |`) sitting between the header and first data row, which
 *     the model's flattened quote never reproduces. Tier 2 can't bridge that
 *     gap (it's missing content, not just whitespace), so tier 3 rebuilds a
 *     pipe-joined stream from the parsed table cells — which have already
 *     dropped the separator row — with a position map back to each
 *     character's real offset in `text`.
 */
export function resolveHighlight(parts: PreviewPart[], quotedText: string): PreviewMatch | null {
  if (!quotedText || !quotedText.trim()) return null;

  for (const p of parts) {
    const idx = p.text.indexOf(quotedText);
    if (idx >= 0) return { part: p.part, start: idx, end: idx + quotedText.length, tier: "exact" };
  }

  const normalizedQuery = collapseWhitespace(normalizeText(quotedText)).toLowerCase();
  if (!normalizedQuery) return null;

  for (const p of parts) {
    const { normalized, posMap } = buildNormalizedIndex(p.text);
    const idx = normalized.indexOf(normalizedQuery);
    if (idx >= 0) {
      const start = posMap[idx];
      const end = posMap[idx + normalizedQuery.length - 1] + 1;
      return { part: p.part, start, end, tier: "normalized" };
    }
  }

  for (const p of parts) {
    const { normalized, posMap } = buildFlattenedBlockIndex(p.blocks);
    const idx = normalized.indexOf(normalizedQuery);
    if (idx < 0) continue;
    const real = posMap.slice(idx, idx + normalizedQuery.length).filter((x): x is number => x >= 0);
    if (!real.length) continue;
    return { part: p.part, start: Math.min(...real), end: Math.max(...real) + 1, tier: "flattened" };
  }

  return null;
}

/**
 * Position-preserving normalize: same character substitutions as
 * normalizeChar plus lowercasing and whitespace collapse, but — unlike
 * normalizeText/collapseWhitespace — keeping a parallel index back into the
 * original string, since a highlight range must land in `text`'s coordinate
 * space, not a scratch copy of it.
 */
function buildNormalizedIndex(text: string): { normalized: string; posMap: number[] } {
  let normalized = "";
  const posMap: number[] = [];
  let lastWasSpace = true; // suppresses leading whitespace, matching collapseWhitespace's .trim()

  for (let idx = 0; idx < text.length; idx++) {
    const mapped = normalizeChar(text[idx]);
    if (!mapped) continue;
    const lower = mapped.toLowerCase();
    const isSpace = /\s/.test(lower);
    if (isSpace) {
      if (lastWasSpace) continue;
      normalized += " ";
      posMap.push(idx);
      lastWasSpace = true;
    } else {
      normalized += lower;
      posMap.push(idx);
      lastWasSpace = false;
    }
  }

  return { normalized, posMap };
}

/**
 * Like buildNormalizedIndex, but built from parsed blocks instead of raw
 * text, and inserting a literal "|" between adjacent table cells — the same
 * shape a model produces when it flattens a table into a quote. Filler
 * characters (the inserted pipes and the spaces around block boundaries)
 * get a `-1` posMap entry rather than a real offset, since they don't
 * correspond to any character in `text`.
 */
function buildFlattenedBlockIndex(blocks: PreviewBlock[]): { normalized: string; posMap: number[] } {
  let normalized = "";
  const posMap: number[] = [];
  let lastWasSpace = true;

  function appendChar(ch: string, pos: number) {
    const lower = ch.toLowerCase();
    const isSpace = /\s/.test(lower);
    if (isSpace) {
      if (lastWasSpace) return;
      normalized += " ";
      posMap.push(pos);
      lastWasSpace = true;
    } else {
      normalized += lower;
      posMap.push(pos);
      lastWasSpace = false;
    }
  }

  function appendLiteral(s: string) {
    for (const ch of s) appendChar(ch, -1);
  }

  function appendRuns(runs: PreviewRun[]) {
    for (const run of runs) {
      if (!run.range) continue; // deletions — not in the accepted view, not quotable
      for (let k = 0; k < run.text.length; k++) {
        const mapped = normalizeChar(run.text[k]);
        if (!mapped) continue;
        appendChar(mapped, run.range.start + k);
      }
      appendLiteral(" ");
    }
  }

  function visit(list: PreviewBlock[]) {
    for (const block of list) {
      if (block.kind === "table") {
        for (const row of block.rows) {
          for (const cell of row.cells) {
            visit(cell.blocks);
            appendLiteral("| ");
          }
        }
      } else {
        appendRuns(block.runs);
      }
    }
  }

  visit(blocks);
  return { normalized, posMap };
}
