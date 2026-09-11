/**
 * Flattens the extracted parts into the single block of text the model reads.
 * Headers and footers are labelled rather than silently concatenated, because a
 * cutoff date in a header is a real contract term and the associate needs to
 * know where a finding came from.
 *
 * Every model call that reads a DOCX goes through this, and so does any eval
 * that claims to measure what production sends.
 */
export function contractText(extracted: { parts: { part: string; text: string }[] }): string {
  return extracted.parts
    .map((part) =>
      part.part === "document"
        ? part.text
        : `\n\n[${part.part.toUpperCase()} — these terms form part of the agreement]\n${part.text}`
    )
    .join("")
    .trim();
}
