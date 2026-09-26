import { extractDocx } from "../docx";
import { tableGrids } from "../docx/table-grid";
import { buildPreview } from "../docx-preview";
import { clauseLabel } from "../format";
import { UNAPPLIED_REASON_TEXT } from "../redline-validation";
import { checkRenderedPdf, renderStructuredPdf, type StructuredPdfMode } from "../structured-pdf";
import { cachedBuild, fingerprint } from "./build-cache";
import type { ExportContext } from "./context";
import { hasEditableWordFile, loadRedline, type LoadedRedline } from "./redline";

export interface StructuredContract {
  pdfBytes: Uint8Array;
  /** Read-back problems. Non-empty means the file must not be delivered. */
  problems: string[];
  /** Changes listed after the contract because the engine could not place them. */
  unplaced: { clause_type: string; reason: string }[];
  redline: LoadedRedline;
}

/**
 * The contract drawn from the tracked-changes Word file, for the marked-up
 * PDF (`markup`) and the proposed contract (`clean`).
 *
 * Null when this analysis can't take that path: a PDF or .doc upload, a Word
 * file the upload check routed to PDF, or a redline §1.6 rejected. The caller
 * then builds its PDF the older way, from the text read at upload.
 */
export async function buildStructuredContract(
  ctx: ExportContext,
  mode: StructuredPdfMode
): Promise<StructuredContract | null> {
  const { associate, analysis, analysisId } = ctx;
  if (!hasEditableWordFile(analysis)) return null;

  const loaded = await loadRedline(ctx);
  if (!loaded.ok || loaded.redline.report.outcome === "fallback") return null;
  const { redline } = loaded;
  const { engineResult, findings } = redline;

  const built = await cachedBuild(
    `${associate.id}:${analysisId}:structured-${mode}`,
    fingerprint([analysis.original_storage_path, associate.name, findings, mode]),
    async () => {
      const parts = buildPreview(await extractDocx(engineResult.docxBytes));
      const body = parts.find((p) => p.part === "document") ?? parts[0];

      const refused = new Set(engineResult.unappliedIds);
      const extra = findings.filter((f) => refused.has(f.id) && f.language.trim());

      const result = await renderStructuredPdf({
        blocks: body?.blocks ?? [],
        mode,
        ownRevisionIds: new Set(engineResult.ownRevisionIds),
        extraChanges: extra.map((f) => ({ label: clauseLabel(f.clause_type), language: f.language })),
        tableGrids: await tableGrids(engineResult.docxBytes),
      });

      const reasonFor = new Map(engineResult.unappliedIds.map((id, i) => [id, engineResult.unapplied[i]?.reason]));
      return {
        pdfBytes: result.pdfBytes,
        problems: await checkRenderedPdf(result),
        unplaced: extra.map((f) => {
          const reason = reasonFor.get(f.id);
          return { clause_type: f.clause_type, reason: reason ? UNAPPLIED_REASON_TEXT[reason] : "Could not be placed." };
        }),
      };
    }
  );

  // A fresh copy each time. pdf-lib can detach the buffer it is handed, and the cached one is handed out again.
  return { ...built, pdfBytes: built.pdfBytes.slice(), redline };
}
