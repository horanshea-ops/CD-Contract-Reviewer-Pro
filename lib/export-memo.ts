import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";

/**
 * Build brief §9, v1 export: "A clean PDF listing each accepted finding:
 * clause reference, current language, proposed language, rationale." Only
 * findings the associate has actually accepted or edited go in — this is a
 * request memo to send to a property, not a dump of every raw finding.
 */

export interface MemoFinding {
  clause_type: string;
  severity: "high" | "medium" | "low" | "note";
  is_missing_clause: boolean;
  quoted_text: string | null;
  language: string; // edited_language if action === "edit", else proposed_language
  finding_text: string;
  cd_standard: string;
}

export interface MemoInput {
  contractFilename: string;
  clientName: string | null;
  associateName: string;
  findings: MemoFinding[];
}

const MARGIN = 56;
const PAGE_SIZE: [number, number] = [612, 792]; // US letter
const MAX_WIDTH = PAGE_SIZE[0] - MARGIN * 2;
const FOOTER_TEXT = "This is a negotiating aid, not legal advice. Confirm every item before sending.";

const SEVERITY_LABEL: Record<MemoFinding["severity"], string> = {
  high: "HIGH",
  medium: "MEDIUM",
  low: "LOW",
  note: "NOTE",
};

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

export async function generateRevisionsMemo(input: MemoInput): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  let page = pdfDoc.addPage(PAGE_SIZE);
  let y = PAGE_SIZE[1] - MARGIN;
  let pageNum = 1;

  function drawFooter(p: PDFPage) {
    p.drawText(FOOTER_TEXT, { x: MARGIN, y: 30, size: 8, font, color: rgb(0.55, 0.55, 0.55) });
    p.drawText(`Page ${pageNum}`, { x: PAGE_SIZE[0] - MARGIN - 40, y: 30, size: 8, font, color: rgb(0.55, 0.55, 0.55) });
  }

  function newPage() {
    drawFooter(page);
    page = pdfDoc.addPage(PAGE_SIZE);
    pageNum += 1;
    y = PAGE_SIZE[1] - MARGIN;
  }

  function ensureSpace(neededHeight: number) {
    if (y - neededHeight < MARGIN + 20) newPage();
  }

  function drawWrapped(text: string, useFont: PDFFont, size: number, lineHeight: number, color = rgb(0, 0, 0)) {
    const lines = wrapText(text, useFont, size, MAX_WIDTH);
    ensureSpace(lines.length * lineHeight);
    for (const line of lines) {
      page.drawText(line, { x: MARGIN, y, size, font: useFont, color });
      y -= lineHeight;
    }
  }

  // Header
  drawWrapped("Requested Revisions", boldFont, 16, 20);
  y -= 4;
  drawWrapped(input.contractFilename, font, 10, 13, rgb(0.35, 0.35, 0.35));
  if (input.clientName) {
    drawWrapped(`Client: ${input.clientName}`, font, 10, 13, rgb(0.35, 0.35, 0.35));
  }
  drawWrapped(`Prepared by ${input.associateName} · ${new Date().toLocaleDateString()}`, font, 10, 13, rgb(0.35, 0.35, 0.35));
  y -= 10;

  if (input.findings.length === 0) {
    drawWrapped("No items have been accepted for this contract yet.", font, 11, 15);
  }

  for (const [i, finding] of input.findings.entries()) {
    ensureSpace(60);
    y -= 6;

    const heading = `${i + 1}. ${SEVERITY_LABEL[finding.severity]} — ${finding.clause_type.replace(/_/g, " ")}`;
    drawWrapped(heading.toUpperCase(), boldFont, 11, 15);

    if (finding.is_missing_clause) {
      drawWrapped("Current language: (clause is missing from the contract)", font, 10, 14, rgb(0.35, 0.35, 0.35));
    } else if (finding.quoted_text) {
      drawWrapped("Current language:", boldFont, 10, 14);
      drawWrapped(finding.quoted_text, font, 10, 14, rgb(0.25, 0.25, 0.25));
    }

    y -= 2;
    drawWrapped("Requested language:", boldFont, 10, 14);
    drawWrapped(finding.language, font, 10, 14);

    y -= 2;
    drawWrapped("Rationale:", boldFont, 10, 14);
    drawWrapped(finding.finding_text, font, 10, 14, rgb(0.25, 0.25, 0.25));

    y -= 12;
  }

  drawFooter(page);

  return pdfDoc.save();
}
