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
      "Content-Disposition": `attachment; filename="${result.filename}"`,
      ...result.extraHeaders,
    },
  });
}
