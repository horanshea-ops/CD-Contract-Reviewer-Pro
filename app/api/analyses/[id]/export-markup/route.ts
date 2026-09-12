import { openExport } from "@/lib/exports/context";
import { buildMarkup } from "@/lib/exports/markup";
import { respondWithExport } from "@/lib/exports/respond";

/** The marked-up PDF. Orchestration lives in lib/exports/markup.ts. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const gate = await openExport(id);
  if (!gate.ok) return gate.response;

  return respondWithExport(await buildMarkup(gate.ctx), { preflight: false });
}
