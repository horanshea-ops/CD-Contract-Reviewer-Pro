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
 * those literals can only be a heading prefix, a resolved list marker, or a
 * heading prefix with its number ("# 1. ") — the only other things
 * `paragraphPrefix()` in walk.ts produces. That gives an
 * unambiguous, context-free way to invert the emission, except for a bare
 * "\n" (an inline `w:br` vs. a table boundary), which is disambiguated by
 * *position* in the grammar below rather than content: a table boundary is
 * only ever tested at a block boundary, never from inside a paragraph's own
 * content loop, and it counts as one only when a row follows it.
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
  | { kind: "heading"; level: 1 | 2 | 3 | 4 | 5 | 6; /** The heading's number, when it is numbered. */ marker?: string; runs: PreviewRun[] }
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
const HEADING_RE = /^(#{1,6}) (?:(.+) )?$/;

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

  /** True if the span after the next one is exactly this synthetic literal. */
  isNextAfter(literal: string): boolean {
    const s = this.spans[this.i + 1];
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

function parsePrefix(text: string): { level: number; marker?: string } | { marker: string; indent: number } {
  const heading = HEADING_RE.exec(text);
  if (heading) return { level: heading[1].length, marker: heading[2] };
  const indentMatch = /^(?: {2})*/.exec(text);
  const indent = indentMatch ? indentMatch[0].length / 2 : 0;
  return { marker: text.slice(indentMatch?.[0].length ?? 0).trimEnd(), indent };
}

function parseParagraph(cur: Cursor, inCell: boolean): PreviewBlock {
  let heading: { level: number; marker?: string } | null = null;
  let listItem: { marker: string; indent: number } | null = null;

  if (cur.isPrefixCandidate()) {
    const prefix = cur.take();
    const parsed = parsePrefix(prefix.text);
    if ("level" in parsed) heading = parsed;
    else listItem = parsed;
  }

  const terminator = inCell ? " " : "\n\n";
  const runs: PreviewRun[] = [];
  while (!cur.done && !cur.isNext(terminator)) {
    runs.push(cur.take());
  }
  if (cur.isNext(terminator)) cur.skip();

  if (heading) {
    const level = heading.level as 1 | 2 | 3 | 4 | 5 | 6;
    return heading.marker ? { kind: "heading", level, marker: heading.marker, runs } : { kind: "heading", level, runs };
  }
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
    // A table opens with a blank line and then a row. A lone "\n" here is a
    // line or page break that opens a paragraph, which isn't drawn.
    if (cur.isNext("\n") && cur.isNextAfter("|")) blocks.push(parseTable(cur));
    else if (cur.isNext("\n")) cur.skip();
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

/** A stretch of a part's text to mark on screen: a highlight, or the wording a comment sits on. */
export interface PreviewMark {
  key: string;
  start: number;
  end: number;
}

export interface RunSegment {
  text: string;
  start: number;
  end: number;
  /** Keys of the marks covering this piece. */
  marks: string[];
}

/** Cuts a run at the edges of every mark crossing it, so each piece is covered by a fixed set of marks. */
export function segmentRun(run: { text: string; range: { start: number; end: number } }, marks: PreviewMark[]): RunSegment[] {
  const { start, end } = run.range;
  const inside = (n: number) => n > start && n < end;
  const cuts = [...new Set([start, end, ...marks.flatMap((m) => [m.start, m.end]).filter(inside)])].sort((a, b) => a - b);

  const segments: RunSegment[] = [];
  for (let i = 0; i + 1 < cuts.length; i++) {
    const [from, to] = [cuts[i], cuts[i + 1]];
    segments.push({
      text: run.text.slice(from - start, to - start),
      start: from,
      end: to,
      marks: marks.filter((m) => m.start < to && m.end > from).map((m) => m.key),
    });
  }
  return segments;
}

/**
 * A range to scroll to and highlight. A comment on struck wording has no width,
 * so the word that follows it stands in, or the word before it at the end of the text.
 */
export function rangeOrNearestWord(text: string, start: number, end: number): { start: number; end: number } {
  if (end > start) return { start, end };

  let from = start;
  while (from < text.length && /\s/.test(text[from])) from++;
  let to = from;
  while (to < text.length && !/\s/.test(text[to])) to++;
  if (to > from) return { start: from, end: to };

  to = start;
  while (to > 0 && /\s/.test(text[to - 1])) to--;
  from = to;
  while (from > 0 && !/\s/.test(text[from - 1])) from--;
  return { start: from, end: to };
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

/**
 * A tracked change already in the file, as one margin note.
 *
 * Word records a replacement as a deletion beside an insertion, each its own
 * revision. Neighbouring revisions by one author in one paragraph are read
 * here as one change, which is how a reader sees them.
 */
export interface RevisionNote {
  key: string;
  part: string;
  kind: "added" | "deleted" | "replaced" | "moved";
  author: string;
  /** ISO string of the latest revision in the change, or empty. */
  date: string;
  /** The wording taken out. Empty for an addition. */
  was: string;
  /** The wording put in. Empty for a deletion. */
  now: string;
}

export interface RevisionNotes {
  notes: RevisionNote[];
  /** Each run that belongs to a change, by the change's key. */
  keyOfRun: Map<PreviewRun, string>;
}

const REMOVES = (run: PreviewRun) => run.revision?.kind === "del" || run.revision?.kind === "moveFrom";

export function revisionNotes(parts: PreviewPart[]): RevisionNotes {
  const notes: RevisionNote[] = [];
  const keyOfRun = new Map<PreviewRun, string>();

  // A change can cover part of a word: "700" to "750" is stored as "00" struck and "50" added.
  // The rest of the word is read from the plain text either side, so the note shows whole words.
  const plain = (run: PreviewRun | undefined) => !!run && !run.revision && run.kind === "text";

  const close = (part: string, runs: PreviewRun[], from: number, to: number) => {
    const group = runs.slice(from, to);
    if (group.length === 0) return;

    let before = "";
    for (let i = from - 1; plain(runs[i]) && !/\s/.test(before); i--) before = runs[i].text + before;
    let after = "";
    for (let i = to; plain(runs[i]) && !/\s/.test(after); i++) after += runs[i].text;
    const head = (/\S{1,20}$/.exec(before)?.[0] ?? "").replace(/^[(["“]+/, "");
    const tail = (/^\S{1,20}/.exec(after)?.[0] ?? "").replace(/[,.;:)\]"”]+$/, "");
    const whole = (text: string) => (text ? head + text + tail : "");
    const was = whole(group.filter(REMOVES).map((r) => r.text).join(""));
    const now = whole(group.filter((r) => !REMOVES(r)).map((r) => r.text).join(""));
    const moved = group.every((r) => r.revision?.kind === "moveFrom" || r.revision?.kind === "moveTo");
    const key = `change-${notes.length + 1}`;
    notes.push({
      key,
      part,
      kind: moved ? "moved" : was && now ? "replaced" : now ? "added" : "deleted",
      author: group[0].revision?.author ?? "",
      date: group.map((r) => r.revision?.date ?? "").sort().at(-1) ?? "",
      was,
      now,
    });
    for (const run of group) keyOfRun.set(run, key);
  };

  const visit = (part: string, blocks: PreviewBlock[]) => {
    for (const block of blocks) {
      if (block.kind === "table") {
        for (const row of block.rows) for (const cell of row.cells) visit(part, cell.blocks);
        continue;
      }
      // `from` is where the open change starts, or -1 when none is open.
      let from = -1;
      block.runs.forEach((run, i) => {
        const sameChange = from !== -1 && run.revision?.author === block.runs[from].revision?.author;
        if (from !== -1 && !sameChange) {
          close(part, block.runs, from, i);
          from = -1;
        }
        if (run.revision && from === -1) from = i;
      });
      if (from !== -1) close(part, block.runs, from, block.runs.length);
    }
  };

  for (const part of parts) visit(part.part, part.blocks);
  return { notes, keyOfRun };
}

/** A comment with the replies under it, in the order the file gives them. */
export interface CommentThread<C> {
  root: C;
  replies: C[];
}

/** Groups comments into threads. A reply whose parent isn't among the comments stands as its own thread. */
export function commentThreads<C extends { id: string; replyTo: string | null }>(comments: C[]): CommentThread<C>[] {
  const byId = new Map(comments.map((c) => [c.id, c]));
  const rootOf = (c: C): C => {
    let at = c;
    const seen = new Set<string>();
    while (at.replyTo && byId.has(at.replyTo) && !seen.has(at.id)) {
      seen.add(at.id);
      at = byId.get(at.replyTo)!;
    }
    return at;
  };

  const threads = new Map<string, CommentThread<C>>();
  for (const c of comments) {
    const root = rootOf(c);
    const thread = threads.get(root.id) ?? { root, replies: [] };
    if (c !== root) thread.replies.push(c);
    threads.set(root.id, thread);
  }
  return [...threads.values()];
}

/**
 * Where each margin note sits. A note sits level with its wording unless the
 * note above it is in the way, and then it sits just below that one. Notes
 * keep the order of their wording.
 */
export function stackNotes(notes: { key: string; anchorTop: number; height: number }[], gap: number): Map<string, number> {
  const tops = new Map<string, number>();
  let floor = 0;
  const inOrder = notes.map((note, index) => ({ note, index })).sort((a, b) => a.note.anchorTop - b.note.anchorTop || a.index - b.index);
  for (const { note } of inOrder) {
    const top = Math.max(note.anchorTop, floor);
    tops.set(note.key, top);
    floor = top + note.height + gap;
  }
  return tops;
}
