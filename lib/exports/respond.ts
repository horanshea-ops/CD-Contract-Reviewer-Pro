import { NextResponse } from "next/server";
import type { ExportBuildResult } from "./types";

/**
 * Turns a builder result into the response a single-file export route returns.
 *
 * `preflight` decides whether the side effects run. A preflight request reports
 * the verdict and commits nothing, so the dialog can check a format without
 * double-counting it in `exports` (§1.6.5).
 */
export async function respondWithExport(
  result: ExportBuildResult,
  { preflight }: { preflight: boolean }
): Promise<NextResponse> {
  if (result.kind === "refusal") {
    if (preflight && result.preflight) {
      return NextResponse.json(result.preflight);
    }
    if (!preflight) await result.commit?.();
    return NextResponse.json(result.body, { status: result.status });
  }

  if (preflight && result.preflight) {
    return NextResponse.json(result.preflight);
  }

  await result.commit();

  return new NextResponse(Buffer.from(result.bytes), {
    status: 200,
    headers: {
      "Content-Type": result.contentType,
      "Content-Disposition": contentDisposition(result.filename),
      ...result.extraHeaders,
    },
  });
}

/**
 * Builds an attachment header that survives a real contract filename.
 *
 * HTTP headers are latin-1, and the redline names its file after the uploaded
 * contract — "Harborview Grand — NACE Annual Meeting.docx". Putting that em dash
 * straight into the header throws before a byte reaches the associate. RFC 5987's
 * `filename*` carries the real name; the plain `filename` keeps a stripped-down
 * version for anything that ignores it.
 */
export function contentDisposition(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7E]/g, "-").replace(/["\\]/g, "");
  const encoded = encodeURIComponent(filename);
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}
