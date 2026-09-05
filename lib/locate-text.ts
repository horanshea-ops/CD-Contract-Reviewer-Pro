import type { RenderedLine } from "./text-to-pdf";

/**
 * Finds which positioned lines (or PDF text items — see lib/extract-pdf-lines.ts)
 * a piece of quoted text corresponds to, tolerating whitespace differences.
 * Shared by the marked-up-PDF export (lib/redline-pdf.ts) and analysis-time
 * location persistence (lib/analysis-pipeline.ts), so both agree on what
 * "locatable" means.
 */

function normalize(s: string): string {
  return s.replace(/\s+/g, " ").trim().toLowerCase();
}

export function findMatchingLineIndices(lines: RenderedLine[], quotedText: string): number[] | null {
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
