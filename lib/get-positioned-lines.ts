import type { createAdminClient } from "./supabase/admin";
import { extractPdfLines } from "./extract-pdf-lines";
import type { RenderedLine } from "./text-to-pdf";
import type { SourceFormat } from "./document-conversion";

const STORAGE_BUCKET = "contracts";

/**
 * Gets positioned text for an analysis's stored PDF, however it needs to be
 * sourced: real PDF text extraction for genuinely PDF-sourced analyses, or
 * the line-position sidecar recorded at generation time for DOCX/DOC-sourced
 * ones. Shared by the marked-up-PDF export and analysis-time location
 * persistence, so both agree on what "locatable" means.
 */
export async function getPositionedLines({
  admin,
  associateId,
  analysisId,
  sourceFormat,
  pdfBytes,
}: {
  admin: ReturnType<typeof createAdminClient>;
  associateId: string;
  analysisId: string;
  sourceFormat: SourceFormat;
  pdfBytes: Uint8Array;
}): Promise<RenderedLine[]> {
  if (sourceFormat === "pdf") {
    // A separate copy: unpdf appears to detach/consume the underlying buffer
    // it's given, which would otherwise corrupt the caller's copy of the
    // same bytes if they still need it (e.g. to hand to pdf-lib).
    return extractPdfLines(pdfBytes.slice());
  }

  const positionsPath = `${associateId}/${analysisId}/line-positions.json`;
  const { data: positionsBlob, error } = await admin.storage.from(STORAGE_BUCKET).download(positionsPath);
  if (error || !positionsBlob) {
    throw new Error(`Could not load document layout data: ${error?.message ?? "unknown error"}`);
  }
  return JSON.parse(await positionsBlob.text());
}
