import { extractTextItems } from "unpdf";
import type { RenderedLine } from "./text-to-pdf";

/**
 * Extracts positioned text from a genuinely PDF-sourced contract, in the
 * same shape lib/text-to-pdf.ts produces for DOCX/DOC-generated PDFs — so
 * lib/redline-pdf.ts's matching/drawing code works unchanged for both.
 *
 * unpdf's items are word/run-level, not full lines, which is finer-grained
 * than the DOCX/DOC path (whole lines). That's an advantage here, not a
 * gap: a strikethrough over several small matched items lands on exactly
 * the matched substring rather than the whole line. The real risk in this
 * phase is elsewhere — item order can depart from visual reading order in
 * multi-column or table layouts, since it reflects the PDF's content
 * stream, not necessarily what a person would read left-to-right.
 */
export async function extractPdfLines(pdfBytes: Uint8Array): Promise<RenderedLine[]> {
  const { items } = await extractTextItems(pdfBytes);

  const lines: RenderedLine[] = [];
  items.forEach((pageItems, pageIndex) => {
    for (const item of pageItems) {
      if (!item.str.trim()) continue;
      lines.push({
        text: item.str,
        pageIndex,
        x: item.x,
        y: item.y,
        width: item.width,
        height: item.height,
      });
    }
  });

  return lines;
}
