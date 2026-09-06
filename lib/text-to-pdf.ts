import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";

/**
 * Renders plain extracted text into a simple paginated PDF. Used for
 * DOCX/DOC uploads (see lib/document-conversion.ts) — this is deliberately
 * not a pixel-faithful re-creation of the original Word layout (no tables,
 * headers/footers, or styling), just the actual paragraph text, flowed and
 * paginated. Good enough for clause-level analysis (which is fundamentally
 * about the words, not the formatting) and honest about the tradeoff in the
 * UI rather than silently pretending it's the original document.
 *
 * Also returns the exact position of every line it draws. Because this same
 * loop both renders the text AND reports where it put it, a marked-up-PDF
 * export can find a finding's quoted text by exact substring match against
 * this data — no fuzzy PDF text-extraction/matching needed, since there's
 * nothing foreign to reconcile against.
 */

const MARGIN = 56;
const PAGE_SIZE: [number, number] = [612, 792]; // US letter
const MAX_WIDTH = PAGE_SIZE[0] - MARGIN * 2;
const FONT_SIZE = 10;
const LINE_HEIGHT = 14;
const PARAGRAPH_GAP = 6;

export interface RenderedLine {
  text: string;
  pageIndex: number;
  x: number;
  y: number; // baseline
  width: number;
  height: number;
}

export interface TextToPdfResult {
  pdfBytes: Uint8Array;
  lines: RenderedLine[];
}

// Word documents commonly use symbol-font glyphs (checkboxes, dingbat
// bullets, arrows) for things like "[ ] Check any that may apply" lists.
// The standard Helvetica font used below only supports WinAnsi (Windows-1252)
// encoding, which doesn't include most of these — pdf-lib throws rather than
// substituting, which would otherwise crash the whole upload on a perfectly
// normal contract. Known list-marker-shaped symbols get a plain-text
// equivalent; anything else unencodable is dropped rather than raising.
const SYMBOL_SUBSTITUTIONS: Record<string, string> = {
  "☐": "-", // ☐ ballot box
  "☑": "-", // ☑ ballot box with check
  "☒": "-", // ☒ ballot box with x
  "■": "-", // ■ black square
  "□": "-", // □ white square
  "▪": "-", // ▪ black small square
  "▫": "-", // ▫ white small square
  "●": "-", // ● black circle
  "○": "-", // ○ white circle
  "▶": "-", // ▶ black right-pointing triangle
  "▸": "-", // ▸ black right-pointing small triangle
  "‣": "-", // ‣ triangular bullet
  "→": "->", // →
  "←": "<-", // ←
  "↑": "^", // ↑
  "↓": "v", // ↓
};

function sanitizeForFont(text: string, font: PDFFont): string {
  let result = "";
  for (const ch of text) {
    const substitute = SYMBOL_SUBSTITUTIONS[ch];
    if (substitute !== undefined) {
      result += substitute;
      continue;
    }
    try {
      font.encodeText(ch);
      result += ch;
    } catch {
      // Not in this font's encoding and no known substitution — drop it
      // rather than crash the conversion over one stray glyph.
    }
  }
  return result;
}

function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [""];
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const trial = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(trial, size) > maxWidth) {
      if (current) lines.push(current);
      current = word;
    } else {
      current = trial;
    }
  }
  if (current) lines.push(current);
  return lines;
}

export async function textToPdf(title: string, bodyText: string): Promise<TextToPdfResult> {
  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  title = sanitizeForFont(title, boldFont);
  bodyText = sanitizeForFont(bodyText, font);

  let page = pdfDoc.addPage(PAGE_SIZE);
  let pageIndex = 0;
  let y = PAGE_SIZE[1] - MARGIN;
  const renderedLines: RenderedLine[] = [];

  function newPage() {
    page = pdfDoc.addPage(PAGE_SIZE);
    pageIndex += 1;
    y = PAGE_SIZE[1] - MARGIN;
  }

  function ensureSpace(neededHeight: number) {
    if (y - neededHeight < MARGIN) newPage();
  }

  const titleLines = wrapText(title, boldFont, 13, MAX_WIDTH);
  ensureSpace(titleLines.length * 17);
  for (const line of titleLines) {
    page.drawText(line, { x: MARGIN, y, size: 13, font: boldFont, color: rgb(0, 0, 0) });
    y -= 17;
  }
  y -= 10;

  const paragraphs = bodyText.split(/\n{2,}|\n/).map((p) => p.trim());

  for (const paragraph of paragraphs) {
    if (!paragraph) {
      y -= PARAGRAPH_GAP;
      continue;
    }
    const lines = wrapText(paragraph, font, FONT_SIZE, MAX_WIDTH);
    ensureSpace(lines.length * LINE_HEIGHT);
    for (const line of lines) {
      page.drawText(line, { x: MARGIN, y, size: FONT_SIZE, font, color: rgb(0, 0, 0) });
      renderedLines.push({
        text: line,
        pageIndex,
        x: MARGIN,
        y,
        width: font.widthOfTextAtSize(line, FONT_SIZE),
        height: LINE_HEIGHT,
      });
      y -= LINE_HEIGHT;
    }
    y -= PARAGRAPH_GAP;
  }

  const pageCount = pdfDoc.getPageCount();
  const pages = pdfDoc.getPages();
  for (let i = 0; i < pageCount; i++) {
    const p: PDFPage = pages[i];
    p.drawText(`Page ${i + 1} of ${pageCount}`, {
      x: PAGE_SIZE[0] - MARGIN - 70,
      y: 30,
      size: 8,
      font,
      color: rgb(0.55, 0.55, 0.55),
    });
  }

  const pdfBytes = await pdfDoc.save();
  return { pdfBytes, lines: renderedLines };
}
