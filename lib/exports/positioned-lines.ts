import { getPositionedLines } from "../get-positioned-lines";
import type { RenderedLine } from "../text-to-pdf";
import type { ExportContext } from "./context";
import { cachedBuild, fingerprint } from "./build-cache";

const STORAGE_BUCKET = "contracts";

export type PositionedLinesResult =
  | { ok: true; lines: RenderedLine[]; pdfBytes: Uint8Array }
  | { ok: false; error: string };

/**
 * The stored PDF and its positioned text, which the marked-up PDF and the
 * proposed contract both read.
 *
 * Cached per analysis, so a zip carrying both formats downloads and extracts
 * once. The stored PDF never changes for an analysis, so the fingerprint is
 * just its path.
 */
export async function positionedLinesFor(ctx: ExportContext): Promise<PositionedLinesResult> {
  const { admin, analysis, analysisId } = ctx;

  try {
    const value = await cachedBuild(
      `${analysisId}:lines`,
      fingerprint([analysis.storage_path, analysis.source_format]),
      async () => {
        const { data: pdfBlob, error } = await admin.storage
          .from(STORAGE_BUCKET)
          .download(analysis.storage_path);
        if (error || !pdfBlob) {
          throw new LoadError(`Could not load the document: ${error?.message}`);
        }

        const pdfBytes = new Uint8Array(await pdfBlob.arrayBuffer());
        const lines = await getPositionedLines({
          admin,
          associateId: analysis.associate_id,
          analysisId,
          sourceFormat: analysis.source_format,
          pdfBytes,
        });
        return { lines, pdfBytes };
      }
    );

    // A fresh copy each time. pdf-lib and unpdf can detach the buffer they are
    // handed, and the cached one is handed out again.
    return { ok: true, lines: value.lines, pdfBytes: value.pdfBytes.slice() };
  } catch (err) {
    if (err instanceof LoadError) return { ok: false, error: err.message };
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Could not read this document's text.",
    };
  }
}

/** Separates a storage failure from a text-extraction one, which read differently. */
class LoadError extends Error {}
