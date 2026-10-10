import { openExport } from "@/lib/exports/context";
import { buildCleanDocx } from "@/lib/exports/clean-docx";
import { respondWithExport } from "@/lib/exports/respond";

/**
 * The proposed contract as a Word file. Orchestration lives in lib/exports/clean-docx.ts.
 *
 * `?preflight=1` returns what the copy lacks as JSON without the file, so the
 * associate reads it before deciding to download.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const gate = await openExport(id);
  if (!gate.ok) return gate.response;

  const preflight = new URL(request.url).searchParams.get("preflight") === "1";
  return respondWithExport(await buildCleanDocx(gate.ctx), { preflight });
}
