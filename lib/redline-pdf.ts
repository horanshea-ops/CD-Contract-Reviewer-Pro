import { PDFDocument, StandardFonts, rgb, type PDFFont, type RGB } from "pdf-lib";
import type { RenderedLine } from "./text-to-pdf";
import type { MemoFinding } from "./export-memo";

/**
 * Draws a marked-up version of an already-rendered contract PDF: a
 * strikethrough over each accepted/edited finding's quoted text, a small
 * numbered marker in the left margin, and a numbered appendix at the end
 * with the full requested language and rationale for each.
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

const SEVERITY_COLOR: Record<MemoFinding["severity"], RGB> = {
  high: rgb(0.7, 0.15, 0.12),
  medium: rgb(0.63, 0.36, 0),
  low: rgb(0.35, 0.39, 0.45),
  note: rgb(0.54, 0.58, 0.64),
};

function normalize(s: string): string {
  return s.replace(/\s+/g, " ").trim().toLowerCase();
}

function findMatchingLineIndices(lines: RenderedLine[], quotedText: string): number[] | null {
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
        const color = SEVERITY_COLOR[finding.severity];

        for (const li of lineIndices) {
          const line = lines[li];
          const page = pages[line.pageIndex];
          const strikeY = line.y + line.height * 0.3;
          page.drawLine({
            start: { x: line.x, y: strikeY },
            end: { x: line.x + line.width, y: strikeY },
            thickness: 1,
            color,
          });
        }

        const firstLine = lines[lineIndices[0]];
        pages[firstLine.pageIndex].drawText(`[${number}]`, {
          x: MARKER_X,
          y: firstLine.y,
          size: 8,
          font: boldFont,
          color,
        });
      }
    }

    numbered.push({ finding, number, matched });
  });

  // Appendix: full detail per numbered item.
  let page = pdfDoc.addPage(PAGE_SIZE);
  let y = PAGE_SIZE[1] - MARGIN;

  function newPage() {
    page = pdfDoc.addPage(PAGE_SIZE);
    y = PAGE_SIZE[1] - MARGIN;
  }
  function ensureSpace(h: number) {
    if (y - h < MARGIN + 20) newPage();
  }
  function drawWrapped(text: string, useFont: PDFFont, size: number, lineHeight: number, color: RGB = rgb(0, 0, 0)) {
    const wrapped = wrapText(text, useFont, size, MAX_WIDTH);
    ensureSpace(wrapped.length * lineHeight);
    for (const line of wrapped) {
      page.drawText(line, { x: MARGIN, y, size, font: useFont, color });
      y -= lineHeight;
    }
  }

  drawWrapped("Redline Notes", boldFont, 16, 20);
  y -= 4;
  drawWrapped(
    "Numbered markers in the margin above correspond to the items below. This is a negotiating aid, not legal advice.",
    font,
    9,
    12,
    rgb(0.45, 0.45, 0.45)
  );
  y -= 10;

  const missing = numbered.filter((n) => n.finding.is_missing_clause);
  const located = numbered.filter((n) => !n.finding.is_missing_clause);

  for (const { finding, number, matched } of located) {
    ensureSpace(50);
    y -= 6;
    const heading = `[${number}] ${finding.severity.toUpperCase()} — ${finding.clause_type.replace(/_/g, " ")}`;
    drawWrapped(heading.toUpperCase(), boldFont, 11, 15, SEVERITY_COLOR[finding.severity]);
    if (!matched) {
      drawWrapped(
        "(Could not locate this exact passage in the document to mark it — shown here only.)",
        font,
        9,
        12,
        rgb(0.55, 0.55, 0.55)
      );
    }
    drawWrapped("Requested language:", boldFont, 10, 14);
    drawWrapped(finding.language, font, 10, 14);
    drawWrapped("Rationale:", boldFont, 10, 14);
    drawWrapped(finding.finding_text, font, 10, 14, rgb(0.25, 0.25, 0.25));
    y -= 10;
  }

  if (missing.length > 0) {
    ensureSpace(40);
    y -= 10;
    drawWrapped("REQUESTED ADDITIONS (clauses not present in the original)", boldFont, 12, 16);
    y -= 4;
    for (const { finding, number } of missing) {
      ensureSpace(50);
      const heading = `[${number}] ${finding.severity.toUpperCase()} — ${finding.clause_type.replace(/_/g, " ")}`;
      drawWrapped(heading.toUpperCase(), boldFont, 11, 15, SEVERITY_COLOR[finding.severity]);
      drawWrapped("Requested language:", boldFont, 10, 14);
      drawWrapped(finding.language, font, 10, 14);
      drawWrapped("Rationale:", boldFont, 10, 14);
      drawWrapped(finding.finding_text, font, 10, 14, rgb(0.25, 0.25, 0.25));
      y -= 10;
    }
  }

  return pdfDoc.save();
}
