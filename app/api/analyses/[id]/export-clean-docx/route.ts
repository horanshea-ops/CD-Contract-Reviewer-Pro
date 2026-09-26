import { openExport } from "@/lib/exports/context";
import { buildCleanDocx } from "@/lib/exports/clean-docx";
import { respondWithExport } from "@/lib/exports/respond";

/** The proposed contract as a Word file. Orchestration lives in lib/exports/clean-docx.ts. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const gate = await openExport(id);
  if (!gate.ok) return gate.response;

  return respondWithExport(await buildCleanDocx(gate.ctx), { preflight: false });
}
