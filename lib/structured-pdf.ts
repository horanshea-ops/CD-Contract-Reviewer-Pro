import { readFileSync } from "node:fs";
import path from "node:path";
import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, rgb, type PDFFont, type PDFPage, type RGB } from "pdf-lib";
import { extractTextItems } from "unpdf";
import type { PreviewBlock, PreviewCell, PreviewRun } from "./docx-preview";
import { SYMBOL_SUBSTITUTIONS } from "./text-to-pdf";
import type { TableGrid } from "./docx/table-grid";

/**
 * Draws a Word contract as a PDF from its structure: headings, paragraphs,
 * list items and tables, in the order the document has them.
 *
 * The input is the §1.4a preview blocks of the tracked-changes DOCX the redline
 * engine produced, so the PDF shows exactly the changes that file carries.
 *
 *   markup  our deletions in red strikethrough, our insertions in blue underline
 *   clean   our deletions dropped, our insertions set as ordinary text
 *
 * Revisions already in the document when the property sent it are shown as
 * they currently read, in both modes. Only this export's own changes are marked.
 *
 * Text is set in Liberation Sans, embedded in the file (assets/fonts, with its
 * licence). The standard PDF fonts are not embedded, so each viewer substitutes
 * its own, and Mac Preview draws "€" over the digit that follows it.
 *
 * It keeps structure, not Word's exact fonts or spacing. Headers, footers and
 * pictures are left out, and every page gets its own page number.
 */

export type StructuredPdfMode = "markup" | "clean";

export interface ExtraChange {
  label: string;
  language: string;
}

export interface StructuredPdfInput {
  /** The document part's blocks. */
  blocks: PreviewBlock[];
  mode: StructuredPdfMode;
  /** `w:id`s of the revisions this export wrote. */
  ownRevisionIds: ReadonlySet<string>;
  /** Changes the engine could not place in the text, listed after the contract. */
  extraChanges?: ExtraChange[];
  /** Word's grid for each top-level table, from lib/docx/table-grid.ts. */
  tableGrids?: TableGrid[];
}

export interface StructuredPdfResult {
  pdfBytes: Uint8Array;
  pageCount: number;
  /** Every string drawn, in draw order, page numbers excluded. */
  drawn: string[];
  /** Anything drawn outside the page's margins. Empty on a good render. */
  overflow: string[];
}

export const EXTRA_CHANGES_HEADING = "Further Proposed Changes";

const PAGE_W = 612;
const PAGE_H = 792;
const MARGIN_X = 60;
const TOP = 64;
const BOTTOM = 64;
const CONTENT_W = PAGE_W - MARGIN_X * 2;

const BODY_SIZE = 10.5;
const CELL_SIZE = 9.5;
const LEADING = 1.32;
const PARA_GAP = 6;
const HEADING_GAP = 10;
const LIST_INDENT = 18;
const MARKER_GAP = 5;
const CELL_PAD = 4;

const HEADING_SIZE: Record<number, number> = { 1: 12.5, 2: 11.5 };

/** Wide tables set smaller, so narrow columns split fewer words. */
const cellSizeFor = (columns: number) => (columns >= 8 ? 8 : columns >= 6 ? 8.75 : CELL_SIZE);

const BLACK = rgb(0, 0, 0);
const DEL_COLOR = rgb(0.72, 0.07, 0.07);
const INS_COLOR = rgb(0.05, 0.28, 0.72);
const RULE_COLOR = rgb(0.6, 0.6, 0.6);
const PAGE_NUMBER_COLOR = rgb(0.45, 0.45, 0.45);

type Mark = "plain" | "del" | "ins";

interface Fonts {
  regular: PDFFont;
  bold: PDFFont;
}

interface Atom {
  text: string;
  mark: Mark;
  bold: boolean;
  size: number;
  width: number;
  space: boolean;
}

interface Piece {
  text: string;
  mark: Mark;
  bold: boolean;
  size: number;
  x: number;
  width: number;
}

interface Line {
  pieces: Piece[];
  height: number;
  gapBefore: number;
  /** A heading's last line. Never left alone at the foot of a page. */
  keepWithNext?: boolean;
}

interface LayoutContext {
  mode: StructuredPdfMode;
  own: ReadonlySet<string>;
  fonts: Fonts;
  size: number;
}

const font = (fonts: Fonts, bold: boolean) => (bold ? fonts.bold : fonts.regular);
const lineHeight = (size: number) => size * LEADING;

/** How a run shows, or null when it is not in this view at all. */
function markFor(run: PreviewRun, ctx: LayoutContext): Mark | null {
  const rev = run.revision;
  if (!rev) return "plain";
  const removes = rev.kind === "del" || rev.kind === "moveFrom";
  if (!ctx.own.has(rev.id)) return removes ? null : "plain";
  if (ctx.mode === "clean") return removes ? null : "plain";
  return removes ? "del" : "ins";
}

/** Drawn as a vector check mark, because the font has no glyph for one. */
const TICK = "✔";
const TICKS = /([✔✓])/;

/** The font's glyph, a known plain substitute, or nothing — never an empty box. */
function drawable(text: string, f: PDFFont): string {
  const glyphs = (f as unknown as { embedder?: { font?: { hasGlyphForCodePoint(cp: number): boolean } } }).embedder?.font;
  let out = "";
  for (const ch of text) {
    const sub = SYMBOL_SUBSTITUTIONS[ch];
    if (sub !== undefined) out += sub;
    else if (!glyphs || glyphs.hasGlyphForCodePoint(ch.codePointAt(0)!)) out += ch;
  }
  return out;
}

type Token = Atom | "break";

function tokenize(runs: PreviewRun[], ctx: LayoutContext, bold: boolean, size: number): Token[] {
  const f = font(ctx.fonts, bold);
  const out: Token[] = [];
  const push = (text: string, mark: Mark, space: boolean) =>
    out.push({ text, mark, bold, size, width: f.widthOfTextAtSize(text, size), space });

  for (const run of runs) {
    const mark = markFor(run, ctx);
    if (mark === null) continue;
    if (run.kind === "break") {
      out.push("break");
      continue;
    }
    for (const part of run.text.replace(/\t/g, " ").split(/(\s+)/).flatMap((x) => x.split(TICKS))) {
      if (!part) continue;
      const space = /^\s+$/.test(part);
      const tick = TICKS.test(part);
      const text = space ? " " : tick ? TICK : drawable(part, f);
      if (!text) continue;

      // An insertion that runs straight into a deletion reads as one word. Word
      // colours them apart; here a plain space does it.
      const prev = out[out.length - 1];
      if (!space && prev && prev !== "break" && !prev.space && prev.mark !== mark && prev.mark !== "plain" && mark !== "plain") {
        push(" ", "plain", true);
      }
      if (tick) out.push({ text, mark, bold, size, width: size * 0.9, space: false });
      else push(text, mark, space);
    }
  }
  return out;
}

const hasWords = (tokens: Token[]) => tokens.some((t) => t !== "break" && !t.space);

/** Visible text in a run list before any revision is filtered, to tell an emptied paragraph from a blank one. */
const hadText = (runs: PreviewRun[]) => runs.some((r) => r.kind === "text" && r.text.trim());

/** Greedy wrap on spaces. A word wider than the line is split by character. */
function wrap(tokens: Token[], width: number, fonts: Fonts): Atom[][] {
  const lines: Atom[][] = [];
  let cur: Atom[] = [];
  let curW = 0;
  let spaces: Atom[] = [];
  let word: Atom[] = [];

  const flushLine = () => {
    lines.push(cur);
    cur = [];
    curW = 0;
  };

  const placeWord = () => {
    if (!word.length) return;
    const wordW = word.reduce((s, a) => s + a.width, 0);
    const spaceW = cur.length ? spaces.reduce((s, a) => s + a.width, 0) : 0;
    if (cur.length && curW + spaceW + wordW > width) flushLine();

    if (!cur.length && wordW > width) {
      for (const chunk of splitWord(word, width, fonts)) {
        if (cur.length) flushLine();
        cur = chunk;
        curW = chunk.reduce((s, a) => s + a.width, 0);
      }
    } else {
      if (cur.length) cur.push(...spaces);
      cur.push(...word);
      curW += (cur.length > word.length ? spaceW : 0) + wordW;
    }
    word = [];
    spaces = [];
  };

  for (const t of tokens) {
    if (t === "break") {
      placeWord();
      flushLine();
      spaces = [];
      continue;
    }
    if (t.space) {
      placeWord();
      spaces.push(t);
    } else {
      word.push(t);
    }
  }
  placeWord();
  if (cur.length) lines.push(cur);
  return lines;
}

function splitWord(word: Atom[], width: number, fonts: Fonts): Atom[][] {
  const chunks: Atom[][] = [];
  let chunk: Atom[] = [];
  let chunkW = 0;
  for (const atom of word) {
    const f = font(fonts, atom.bold);
    for (const ch of atom.text) {
      const w = f.widthOfTextAtSize(ch, atom.size);
      if (chunk.length && chunkW + w > width) {
        chunks.push(chunk);
        chunk = [];
        chunkW = 0;
      }
      const last = chunk[chunk.length - 1];
      if (last && last.mark === atom.mark && last.bold === atom.bold) {
        last.text += ch;
        last.width += w;
      } else {
        chunk.push({ ...atom, text: ch, width: w });
      }
      chunkW += w;
    }
  }
  if (chunk.length) chunks.push(chunk);
  return chunks;
}

/** Joins neighbouring atoms of one style, so each styled stretch is drawn once. */
function toPieces(atoms: Atom[], x: number): Piece[] {
  const pieces: Piece[] = [];
  let at = x;
  for (const a of atoms) {
    const last = pieces[pieces.length - 1];
    const tick = a.text === TICK || last?.text === TICK;
    if (last && !tick && last.mark === a.mark && last.bold === a.bold && last.size === a.size) {
      last.text += a.text;
      last.width += a.width;
    } else {
      pieces.push({ text: a.text, mark: a.mark, bold: a.bold, size: a.size, x: at, width: a.width });
    }
    at += a.width;
  }
  // A trailing space would underline or strike past the last word.
  const last = pieces[pieces.length - 1];
  if (last && last.text.endsWith(" ")) {
    const trimmed = last.text.trimEnd();
    last.width -= last.width * ((last.text.length - trimmed.length) / last.text.length);
    last.text = trimmed;
  }
  return pieces.filter((p) => p.text);
}

interface ParagraphOptions {
  width: number;
  bold?: boolean;
  size: number;
  indent?: number;
  marker?: string;
  gapBefore: number;
  keepWithNext?: boolean;
}

function layoutParagraph(runs: PreviewRun[], ctx: LayoutContext, opts: ParagraphOptions): Line[] {
  const bold = opts.bold ?? false;
  const tokens = tokenize(runs, ctx, bold, opts.size);
  if (!hasWords(tokens)) return [];

  const indent = opts.indent ?? 0;
  let textX = indent;
  let markerPiece: Piece | null = null;
  if (opts.marker) {
    const f = font(ctx.fonts, false);
    const text = drawable(opts.marker === "-" ? "•" : opts.marker, f);
    const w = f.widthOfTextAtSize(text, opts.size);
    markerPiece = { text, mark: "plain", bold: false, size: opts.size, x: indent, width: w };
    textX = indent + Math.max(LIST_INDENT, w + MARKER_GAP);
  }

  const wrapped = wrap(tokens, Math.max(opts.width - textX, 8), ctx.fonts);
  const height = lineHeight(opts.size);
  return wrapped.map((atoms, i) => ({
    pieces: [...(i === 0 && markerPiece ? [markerPiece] : []), ...toPieces(atoms, textX)],
    height,
    gapBefore: i === 0 ? opts.gapBefore : 0,
    keepWithNext: opts.keepWithNext && i === wrapped.length - 1,
  }));
}

/**
 * Lines for a run of non-table blocks. Inside a table cell, a nested table's
 * cells are laid out one after another rather than side by side.
 */
function layoutBlocks(blocks: PreviewBlock[], width: number, ctx: LayoutContext): Line[] {
  const lines: Line[] = [];
  let gap = 0;

  const add = (more: Line[]) => {
    lines.push(...more);
    gap = PARA_GAP;
  };

  for (const block of blocks) {
    if (block.kind === "table") {
      for (const row of block.rows) for (const cell of row.cells) add(layoutBlocks(cell.blocks, width, ctx));
      continue;
    }
    const first = lines.length === 0;
    if (block.kind === "heading") {
      const size = ctx.size === BODY_SIZE ? (HEADING_SIZE[block.level] ?? BODY_SIZE) : ctx.size;
      add(
        layoutParagraph(block.runs, ctx, {
          width,
          size,
          bold: true,
          gapBefore: first ? 0 : Math.max(gap, HEADING_GAP),
          keepWithNext: true,
        })
      );
      continue;
    }
    const laid = layoutParagraph(block.runs, ctx, {
      width,
      size: ctx.size,
      indent: block.kind === "list-item" ? block.indent * LIST_INDENT : 0,
      marker: block.kind === "list-item" ? block.marker : undefined,
      gapBefore: first ? 0 : gap,
    });
    if (laid.length) add(laid);
    else if (!hadText(block.runs) && block.kind === "paragraph" && lines.length) gap = PARA_GAP * 2;
  }
  return lines;
}

/** Widest paragraph and widest word in a cell, measured on one line. */
function cellExtent(cell: PreviewCell, ctx: LayoutContext): { natural: number; word: number } {
  let natural = 0;
  let word = 0;
  const visit = (blocks: PreviewBlock[]) => {
    for (const b of blocks) {
      if (b.kind === "table") {
        for (const row of b.rows) for (const c of row.cells) visit(c.blocks);
        continue;
      }
      const tokens = tokenize(b.runs, ctx, b.kind === "heading", ctx.size).filter((t): t is Atom => t !== "break");
      natural = Math.max(natural, tokens.reduce((s, t) => s + t.width, 0));
      for (const t of tokens) if (!t.space) word = Math.max(word, t.width);
    }
  };
  visit(cell.blocks);
  return { natural: natural + CELL_PAD * 2, word: word + CELL_PAD * 2 };
}

/** Column widths, auto-layout style: every column gets its longest word, then space goes where text is. */
function columnWidths(rows: PreviewCell[][], cols: number, ctx: LayoutContext): number[] {
  const natural = new Array(cols).fill(CELL_PAD * 2 + 12);
  const min = new Array(cols).fill(CELL_PAD * 2 + 12);
  for (const cells of rows) {
    if (cells.length !== cols) continue;
    cells.forEach((cell, i) => {
      const e = cellExtent(cell, ctx);
      natural[i] = Math.max(natural[i], e.natural);
      min[i] = Math.max(min[i], Math.min(e.word, CONTENT_W / 2));
    });
  }
  const natSum = natural.reduce((s, n) => s + n, 0);
  if (natSum <= CONTENT_W) return natural.map((n) => (n / natSum) * CONTENT_W);
  const minSum = min.reduce((s, n) => s + n, 0);
  if (minSum >= CONTENT_W) return min.map((n) => (n / minSum) * CONTENT_W);
  const flex = natural.map((n, i) => Math.max(0, n - min[i]));
  const flexSum = flex.reduce((s, n) => s + n, 0) || 1;
  return min.map((m, i) => m + (flex[i] / flexSum) * (CONTENT_W - minSum));
}

class Writer {
  pages: PDFPage[] = [];
  page!: PDFPage;
  y = 0;
  drawn: string[] = [];
  overflow: string[] = [];

  constructor(
    private pdf: PDFDocument,
    private fonts: Fonts
  ) {
    this.newPage();
  }

  newPage() {
    this.page = this.pdf.addPage([PAGE_W, PAGE_H]);
    this.pages.push(this.page);
    this.y = PAGE_H - TOP;
  }

  get atTop() {
    return this.y === PAGE_H - TOP;
  }

  get room() {
    return this.y - BOTTOM;
  }

  drawLine(line: Line, x0: number, top: number) {
    const baseline = top - line.pieces.reduce((m, p) => Math.max(m, p.size), 0);
    for (const p of line.pieces) this.drawPiece(p, x0, baseline);
  }

  private drawPiece(p: Piece, x0: number, baseline: number) {
    const x = x0 + p.x;
    const color: RGB = p.mark === "del" ? DEL_COLOR : p.mark === "ins" ? INS_COLOR : BLACK;
    if (p.text === TICK) {
      const s = p.size;
      const at = (dx: number, dy: number) => ({ x: x + dx * s, y: baseline + dy * s });
      const thickness = s * 0.11;
      this.page.drawLine({ start: at(0.08, 0.38), end: at(0.3, 0.1), thickness, color });
      this.page.drawLine({ start: at(0.3, 0.1), end: at(0.75, 0.72), thickness, color });
    } else {
      this.page.drawText(p.text, { x, y: baseline, size: p.size, font: font(this.fonts, p.bold), color });
    }
    this.drawn.push(p.text);

    if (p.mark === "del") {
      const y = baseline + p.size * 0.3;
      this.page.drawLine({ start: { x, y }, end: { x: x + p.width, y }, thickness: 0.8, color: DEL_COLOR });
    } else if (p.mark === "ins") {
      const y = baseline - 1.6;
      this.page.drawLine({ start: { x, y }, end: { x: x + p.width, y }, thickness: 0.7, color: INS_COLOR });
    }

    if (x + p.width > PAGE_W - MARGIN_X + 1 || baseline < BOTTOM - 16) {
      this.overflow.push(`page ${this.pages.length}: "${p.text.slice(0, 40)}"`);
    }
  }

  /** Flows lines down the page, breaking pages between lines. */
  flow(lines: Line[], x0 = MARGIN_X) {
    for (const line of lines) {
      const gap = this.atTop ? 0 : line.gapBefore;
      let need = gap + line.height;
      if (line.keepWithNext) need += lineHeight(BODY_SIZE) * 3;
      if (need > this.room && !this.atTop) this.newPage();
      if (!this.atTop) this.y -= line.gapBefore;
      this.drawLine(line, x0, this.y);
      this.y -= line.height;
    }
  }

  /** A table, row by row. A row taller than a page continues on the next one. */
  table(rows: PreviewCell[][], rowWidths: number[][], ctx: LayoutContext) {
    const usable = PAGE_H - TOP - BOTTOM;

    if (!this.atTop) this.y -= PARA_GAP;

    rows.forEach((cells, r) => {
      const cellWidths = rowWidths[r];
      const laid = cells.map((cell, i) => layoutBlocks(cell.blocks, cellWidths[i] - CELL_PAD * 2, ctx));
      const heights = laid.map((ls) => ls.reduce((s, l, j) => s + (j ? l.gapBefore : 0) + l.height, 0));
      const rowH = Math.max(lineHeight(ctx.size), ...heights) + CELL_PAD * 2;

      if (rowH > this.room && rowH <= usable) this.newPage();

      const next = laid.map(() => 0);
      for (;;) {
        const top = this.y;
        const avail = this.room - CELL_PAD * 2;
        const used = laid.map((ls, c) => {
          let h = 0;
          while (next[c] < ls.length) {
            const l = ls[next[c]];
            const gap = h ? l.gapBefore : 0;
            if (h + gap + l.height > avail && (h > 0 || !this.atTop)) break;
            this.drawLine(l, MARGIN_X + offset(cellWidths, c) + CELL_PAD, top - CELL_PAD - h - gap);
            h += gap + l.height;
            next[c]++;
          }
          return h;
        });

        const segH = Math.max(lineHeight(ctx.size), ...used) + CELL_PAD * 2;
        const progressed = used.some((h) => h > 0) || laid.every((ls) => ls.length === 0);
        if (progressed) {
          cellWidths.forEach((w, c) => {
            this.page.drawRectangle({
              x: MARGIN_X + offset(cellWidths, c),
              y: top - segH,
              width: w,
              height: segH,
              borderColor: RULE_COLOR,
              borderWidth: 0.5,
            });
          });
          this.y = top - segH;
        }
        if (laid.every((ls, c) => next[c] >= ls.length)) break;
        this.newPage();
      }
    });
    this.y -= PARA_GAP;
  }

  pageNumbers() {
    const total = this.pages.length;
    this.pages.forEach((page, i) => {
      const text = `Page ${i + 1} of ${total}`;
      const w = this.fonts.regular.widthOfTextAtSize(text, 8);
      page.drawText(text, { x: (PAGE_W - w) / 2, y: 36, size: 8, font: this.fonts.regular, color: PAGE_NUMBER_COLOR });
    });
  }
}

const offset = (widths: number[], c: number) => widths.slice(0, c).reduce((s, w) => s + w, 0);

/** Word's grid describes this table: same rows, same cells per row, spans that fit the columns. */
function gridFits(grid: TableGrid, rows: PreviewCell[][]): boolean {
  return (
    grid.columns.length > 0 &&
    grid.columns.every((w) => w > 0) &&
    grid.rows.length === rows.length &&
    grid.rows.every((spans, r) => spans.length === rows[r].length && spans.reduce((s, n) => s + n, 0) <= grid.columns.length)
  );
}

/**
 * Each row's cell widths. Word's own grid when it describes this table, so
 * merged cells keep their span; otherwise widths fitted to the text.
 */
function cellWidthsFor(rows: PreviewCell[][], grid: TableGrid | undefined, ctx: LayoutContext): number[][] {
  if (grid) {
    const points = grid.columns.map((w) => w / 20);
    const total = points.reduce((s, w) => s + w, 0);
    // Scale to the page, except a small table, which keeps its own width.
    const scale = total > CONTENT_W * 0.6 ? CONTENT_W / total : 1;
    const cols = points.map((w) => w * scale);
    return grid.rows.map((spans) => {
      let at = 0;
      return spans.map((span, i) => {
        const end = i === spans.length - 1 && total * scale >= CONTENT_W - 1 ? cols.length : at + span;
        const w = cols.slice(at, end).reduce((s, x) => s + x, 0);
        at += span;
        return w;
      });
    });
  }

  const cols = rows.reduce((m, r) => Math.max(m, r.length), 0);
  const widths = columnWidths(rows, cols, ctx);
  return rows.map((cells) =>
    cells.map((_, i) =>
      i < cells.length - 1 || cells.length === cols ? widths[i] : widths.slice(i).reduce((s, w) => s + w, 0)
    )
  );
}

/** Indices of a table's rows as they read in this view. A row our change emptied is gone, and so is a table. */
function visibleRows(block: Extract<PreviewBlock, { kind: "table" }>, ctx: LayoutContext): number[] {
  const rowText = (cells: PreviewCell[], filtered: boolean) =>
    cells.some((cell) => {
      const visit = (blocks: PreviewBlock[]): boolean =>
        blocks.some((b) =>
          b.kind === "table"
            ? b.rows.some((r) => r.cells.some((c) => visit(c.blocks)))
            : filtered
              ? hasWords(tokenize(b.runs, ctx, false, ctx.size))
              : hadText(b.runs)
        );
      return visit(cell.blocks);
    });
  return block.rows.flatMap((r, i) => (rowText(r.cells, true) || !rowText(r.cells, false) ? [i] : []));
}

const FONT_DIR = path.join(process.cwd(), "assets", "fonts");
let fontFiles: { regular: Buffer; bold: Buffer } | null = null;

function loadFontFiles() {
  fontFiles ??= {
    regular: readFileSync(path.join(FONT_DIR, "LiberationSans-Regular.ttf")),
    bold: readFileSync(path.join(FONT_DIR, "LiberationSans-Bold.ttf")),
  };
  return fontFiles;
}

export async function renderStructuredPdf(input: StructuredPdfInput): Promise<StructuredPdfResult> {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const files = loadFontFiles();
  const fonts: Fonts = {
    regular: await pdf.embedFont(files.regular, { subset: true }),
    bold: await pdf.embedFont(files.bold, { subset: true }),
  };
  const ctx: LayoutContext = { mode: input.mode, own: input.ownRevisionIds, fonts, size: BODY_SIZE };
  const cellCtx: LayoutContext = { ...ctx, size: CELL_SIZE };
  const w = new Writer(pdf, fonts);

  let pending: PreviewBlock[] = [];
  const flushPending = () => {
    if (pending.length) w.flow(layoutBlocks(pending, CONTENT_W, ctx));
    pending = [];
  };

  // Grids are matched in order by shape rather than by count, because
  // extraction can yield a table Word's grid list does not have.
  const grids = input.tableGrids ?? [];
  let nextGrid = 0;
  for (const block of input.blocks) {
    if (block.kind !== "table") {
      pending.push(block);
      continue;
    }
    flushPending();
    const all = block.rows.map((r) => r.cells);
    const found = grids.findIndex((g, i) => i >= nextGrid && gridFits(g, all));
    if (found >= 0) nextGrid = found + 1;
    const cols = found >= 0 ? grids[found].columns.length : Math.max(0, ...all.map((c) => c.length));
    const tableCtx = { ...cellCtx, size: cellSizeFor(cols) };
    const widths = cellWidthsFor(all, found >= 0 ? grids[found] : undefined, tableCtx);
    const keep = visibleRows(block, tableCtx);
    if (keep.length) w.table(keep.map((i) => all[i]), keep.map((i) => widths[i]), tableCtx);
  }
  flushPending();

  if (input.extraChanges?.length) {
    const asRuns = (text: string, ins: boolean): PreviewRun[] => [
      { text, kind: "text", range: null, revision: ins ? { kind: "ins", author: "", date: "", id: "\u0000extra" } : null },
    ];
    const extraCtx: LayoutContext = { ...ctx, own: new Set([...ctx.own, "\u0000extra"]) };
    const blocks: PreviewBlock[] = [{ kind: "heading", level: 2, runs: asRuns(EXTRA_CHANGES_HEADING, false) }];
    for (const change of input.extraChanges) {
      blocks.push({ kind: "heading", level: 3, runs: asRuns(change.label, false) });
      blocks.push({ kind: "paragraph", runs: asRuns(change.language, true) });
    }
    const lines = layoutBlocks(blocks, CONTENT_W, extraCtx);
    if (lines[0]) lines[0].gapBefore = HEADING_GAP * 2;
    w.flow(lines);
  }

  w.pageNumbers();
  const pdfBytes = await pdf.save();
  return { pdfBytes, pageCount: w.pages.length, drawn: w.drawn, overflow: w.overflow };
}

const PAGE_NUMBER = /^Page \d+ of \d+$/;
const alnum = (s: string) => s.replace(/[^\p{L}\p{N}]+/gu, "").toLowerCase();

/**
 * Reads the finished PDF back and confirms it holds every string the renderer
 * drew, in order, inside the page. Returns what went wrong, or an empty list.
 */
export async function checkRenderedPdf(result: StructuredPdfResult): Promise<string[]> {
  const problems = result.overflow.map((o) => `Text was drawn outside the page margins at ${o}.`);
  try {
    const { items } = await extractTextItems(result.pdfBytes.slice());
    const actual = alnum(
      items
        .flat()
        .map((i) => i.str)
        .filter((s) => !PAGE_NUMBER.test(s.trim()))
        .join("")
    );
    const expected = alnum(result.drawn.join(""));
    if (actual !== expected) {
      let i = 0;
      while (i < actual.length && i < expected.length && actual[i] === expected[i]) i++;
      problems.push(
        `The rendered PDF does not read back as drawn, first differing around "…${expected.slice(Math.max(0, i - 30), i + 30)}…".`
      );
    }
  } catch (err) {
    problems.push(`The rendered PDF could not be read back for checking: ${err instanceof Error ? err.message : err}`);
  }
  return problems;
}
