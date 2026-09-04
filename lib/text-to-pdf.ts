import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";

/**
 * Renders plain extracted text into a simple paginated PDF. Used for
 * DOCX/DOC uploads (see lib/document-conversion.ts) — this is deliberately
 * not a pixel-faithful re-creation of the original Word layout (no tables,
 * headers/footers, or styling), just the actual paragraph text, flowed and
 * paginated. Good enough for clause-level analysis (which is fundamentally
 * about the words, not the formatting) and honest about the tradeoff in the
 * UI rather than silently pretending it's the original document.
 */

const MARGIN = 56;
const PAGE_SIZE: [number, number] = [612, 792]; // US letter
const MAX_WIDTH = PAGE_SIZE[0] - MARGIN * 2;
const FONT_SIZE = 10;
const LINE_HEIGHT = 14;
const PARAGRAPH_GAP = 6;

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

export async function textToPdf(title: string, bodyText: string): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  let page = pdfDoc.addPage(PAGE_SIZE);
  let y = PAGE_SIZE[1] - MARGIN;

  function newPage() {
    page = pdfDoc.addPage(PAGE_SIZE);
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

  return pdfDoc.save();
}
