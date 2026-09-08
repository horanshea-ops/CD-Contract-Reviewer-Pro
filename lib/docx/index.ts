import { assessHealth } from "./health";
import { NumberingResolver } from "./numbering";
import { DocxParseError, loadDocx } from "./parts";
import { walkPart } from "./walk";
import type { ExistingRevisions, ExtractedDocument } from "./types";

export { DocxParseError, loadDocx, parseXml } from "./parts";
export type { DocxPackage, ParsedPart } from "./parts";
export { normalizeChar, normalizeText, collapseWhitespace } from "./normalize";
export { NumberingResolver } from "./numbering";
// §1.5 walks parts itself: it needs the DOM and the run elements, which the
// extraction result deliberately does not carry.
export { walkPart } from "./walk";
export type { WalkResult } from "./walk";
export * from "./types";

/**
 * Revision-aware extraction: turns a .docx into analysable text plus a map from
 * every character back to the run it came from (MASTER_PLAN.md §1.4).
 *
 * Two rules govern how this is used elsewhere:
 *
 *  - **Pure and deterministic.** The same bytes always produce the same text and
 *    the same map, which is what lets the map be rebuilt at export time instead
 *    of stored.
 *  - **Never cache the result.** §1.1 is explicit about this. A stale map against
 *    a re-uploaded file is a corruption bug that is very hard to trace, and the
 *    `line-positions.json` sidecar this replaces is exactly that pattern.
 */
export async function extractDocx(
  bytes: Uint8Array | Buffer,
  opts: { fileSizeBytes?: number } = {}
): Promise<ExtractedDocument> {
  const pkg = await loadDocx(bytes);

  // One resolver across all parts so list counters continue rather than
  // restarting in each header.
  const numbering = new NumberingResolver(pkg.numbering);
  const parts = pkg.textParts.map((p) => walkPart(p, numbering));

  const document = parts.find((p) => p.part === "document");
  if (!document) throw new DocxParseError("word/document.xml produced no content.");

  return {
    parts,
    document,
    existingRevisions: summariseRevisions(parts),
    health: assessHealth({ pkg, parts, fileSizeBytes: opts.fileSizeBytes ?? bytes.byteLength }),
  };
}

/**
 * Who has already edited this contract, and how much (§1.4.2). Surfaced in the
 * UI so an associate knows at a glance they are looking at round three rather
 * than a fresh draft.
 */
function summariseRevisions(parts: { markup: { revision: { author: string; date: string } | null }[] }[]): ExistingRevisions {
  const authors = new Set<string>();
  const dates: string[] = [];
  let count = 0;

  for (const part of parts) {
    for (const span of part.markup) {
      if (!span.revision) continue;
      count++;
      if (span.revision.author) authors.add(span.revision.author);
      if (span.revision.date) dates.push(span.revision.date);
    }
  }

  dates.sort();
  return {
    present: count > 0,
    count,
    authors: [...authors].sort(),
    earliest: dates[0] ?? null,
    latest: dates[dates.length - 1] ?? null,
  };
}
