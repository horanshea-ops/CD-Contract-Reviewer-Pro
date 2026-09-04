import mammoth from "mammoth";
import WordExtractor from "word-extractor";
import { textToPdf } from "./text-to-pdf";

export const SUPPORTED_MIME_TYPES = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  doc: "application/msword",
} as const;

export type SourceFormat = "pdf" | "docx" | "doc";

export function detectSourceFormat(mimeType: string): SourceFormat | null {
  if (mimeType === SUPPORTED_MIME_TYPES.pdf) return "pdf";
  if (mimeType === SUPPORTED_MIME_TYPES.docx) return "docx";
  if (mimeType === SUPPORTED_MIME_TYPES.doc) return "doc";
  return null;
}

/**
 * Converts an uploaded DOCX/DOC file into a PDF so it can flow through the
 * existing pipeline unchanged (analysis pipeline requires inline PDF per
 * build brief non-negotiable #3; the document viewer expects one too).
 *
 * This extracts and re-flows the actual paragraph text — it is NOT a
 * pixel-faithful copy of the original layout (no tables, headers, styling).
 * That's an explicit tradeoff to avoid a headless-browser/LibreOffice
 * dependency, which would be heavy and awkward on Vercel. The original
 * file is preserved separately (see the upload route) specifically so nothing
 * is lost — a future tracked-changes/redline feature can still work from it.
 */
export async function convertToPdf(
  fileBuffer: Buffer,
  sourceFormat: "docx" | "doc",
  filename: string
): Promise<Uint8Array> {
  let text: string;

  if (sourceFormat === "docx") {
    const result = await mammoth.extractRawText({ buffer: fileBuffer });
    text = result.value;
  } else {
    const extractor = new WordExtractor();
    const doc = await extractor.extract(fileBuffer);
    text = doc.getBody();
  }

  if (!text || !text.trim()) {
    throw new Error(
      "Could not find any readable text in this document. It may be empty, image-based, or password-protected."
    );
  }

  return textToPdf(filename, text);
}
