import { openExport } from "@/lib/exports/context";
import { buildRedline } from "@/lib/exports/redline";
import { respondWithExport } from "@/lib/exports/respond";

/**
 * The tracked-changes DOCX. Orchestration lives in lib/exports/redline.ts.
 *
 * `?preflight=1` returns the oracle's verdict as JSON without the file, so the
 * associate sees what could not be applied before they download it. Only the
 * request that actually delivers a file writes to `exports`, or every dialog
 * double-counts.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const gate = await openExport(id);
  if (!gate.ok) return gate.response;

  const preflight = new URL(request.url).searchParams.get("preflight") === "1";
  return respondWithExport(await buildRedline(gate.ctx), { preflight });
}
