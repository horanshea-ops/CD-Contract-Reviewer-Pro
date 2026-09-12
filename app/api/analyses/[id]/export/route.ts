import { openExport } from "@/lib/exports/context";
import { buildMemo } from "@/lib/exports/memo";
import { respondWithExport } from "@/lib/exports/respond";

/** The requested-revisions memo. Orchestration lives in lib/exports/memo.ts. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const gate = await openExport(id);
  if (!gate.ok) return gate.response;

  return respondWithExport(await buildMemo(gate.ctx), { preflight: false });
}
