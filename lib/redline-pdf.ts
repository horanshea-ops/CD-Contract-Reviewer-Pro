import { PDFDocument, StandardFonts, rgb, type PDFFont, type RGB } from "pdf-lib";
import type { RenderedLine } from "./text-to-pdf";
import type { MemoFinding } from "./export-memo";
import { findMatchingLineIndices } from "./locate-text";

/**
 * Draws a marked-up version of an already-rendered contract PDF: a cover
 * page summarizing every change in table form, plus a strikethrough over
 * each accepted/edited finding's quoted text and a small numbered marker
 * in the left margin. The cover page is the single source of the change
 * list — earlier versions of this file repeated the same clause/language
 * pairs in a separate appendix, which just meant two lists to keep in
 * sync for no reader benefit.
 *
 * This file's output can end up in front of the property or a client, so
 * it carries the changes and nothing else — no severity, no rationale, no
 * explanation of why a PDF was produced instead of a Word file. That
 * explanation is the app's job, shown to the associate before download
 * (see lib/pdf-markup-reason.ts), never baked into the file itself.
 *
 * Locating quoted text uses the exact line-position data recorded when the
 * PDF was generated from DOCX/DOC text (see lib/text-to-pdf.ts) — an exact
 * substring match against text we rendered ourselves, not a fuzzy search
 * against a foreign PDF's internal text runs. That only works for
 * DOCX/DOC-sourced analyses; genuinely PDF-sourced ones need real PDF
 * text-extraction and fuzzy matching, which is a separate, harder phase.
 */

const MARGIN = 56;
const PAGE_SIZE: [number, number] = [612, 792];
const MAX_WIDTH = PAGE_SIZE[0] - MARGIN * 2;
const MARKER_X = 18;
const MARK_COLOR = rgb(0.63, 0.11, 0.11);

function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    const words = paragraph.split(" ");
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
    lines.push(current);
  }
  return lines;
}

export async function generateMarkupPdf({
  pdfBytes,
  lines,
  findings,
}: {
  pdfBytes: Uint8Array;
  lines: RenderedLine[];
  findings: MemoFinding[];
}): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.load(pdfBytes);
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const pages = pdfDoc.getPages();

  const numbered: { finding: MemoFinding; number: number; matched: boolean }[] = [];

  findings.forEach((finding, i) => {
    const number = i + 1;
    let matched = false;

    if (!finding.is_missing_clause && finding.quoted_text) {
      const lineIndices = findMatchingLineIndices(lines, finding.quoted_text);
      if (lineIndices) {
        matched = true;

        for (const li of lineIndices) {
          const line = lines[li];
          const page = pages[line.pageIndex];
          const strikeY = line.y + line.height * 0.3;
          page.drawLine({
            start: { x: line.x, y: strikeY },
            end: { x: line.x + line.width, y: strikeY },
            thickness: 1,
            color: MARK_COLOR,
          });
        }

        const firstLine = lines[lineIndices[0]];
        pages[firstLine.pageIndex].drawText(`[${number}]`, {
          x: MARKER_X,
          y: firstLine.y,
          size: 8,
          font: boldFont,
          color: MARK_COLOR,
        });
      }
    }

    numbered.push({ finding, number, matched });
  });

  // Cover page(s): a plain-text table of every change, inserted before the
  // annotated body so nothing about reading the changes depends on the
  // strikethrough/margin markers rendering correctly in the recipient's
  // viewer. Purely a function of `findings` — never of why this is a PDF.
  let coverPageIndex = 0;
  let coverPage = pdfDoc.insertPage(coverPageIndex, PAGE_SIZE);
  coverPageIndex += 1;
  let coverY = PAGE_SIZE[1] - MARGIN;

  function newCoverPage() {
    coverPage = pdfDoc.insertPage(coverPageIndex, PAGE_SIZE);
    coverPageIndex += 1;
    coverY = PAGE_SIZE[1] - MARGIN;
  }
  function ensureCoverSpace(h: number) {
    if (coverY - h < MARGIN + 20) newCoverPage();
  }
  function drawCoverWrapped(text: string, useFont: PDFFont, size: number, lineHeight: number, color: RGB = rgb(0, 0, 0)) {
    const wrapped = wrapText(text, useFont, size, MAX_WIDTH);
    ensureCoverSpace(wrapped.length * lineHeight);
    for (const line of wrapped) {
      coverPage.drawText(line, { x: MARGIN, y: coverY, size, font: useFont, color });
      coverY -= lineHeight;
    }
  }

  drawCoverWrapped("Proposed Changes", boldFont, 16, 20);
  coverY -= 4;
  drawCoverWrapped(
    "Numbered markers in the margins below correspond to the items in this table.",
    font,
    9,
    12,
    rgb(0.45, 0.45, 0.45)
  );
  coverY -= 10;

  for (const { finding, number, matched } of numbered) {
    ensureCoverSpace(40);
    coverY -= 4;
    const label = finding.is_missing_clause
      ? "requested addition"
      : matched
        ? "page reference in margin"
        : "not located in document";
    drawCoverWrapped(`[${number}] ${finding.clause_type.replace(/_/g, " ")} (${label})`, boldFont, 10, 14);
    drawCoverWrapped(finding.language, font, 10, 13);
    coverY -= 6;
    ensureCoverSpace(1);
    coverPage.drawLine({
      start: { x: MARGIN, y: coverY + 2 },
      end: { x: MARGIN + MAX_WIDTH, y: coverY + 2 },
      thickness: 0.5,
      color: rgb(0.85, 0.85, 0.85),
    });
  }

  return pdfDoc.save();
}
