import { openExport } from "@/lib/exports/context";
import { buildCleanContract } from "@/lib/exports/clean-contract";
import { respondWithExport } from "@/lib/exports/respond";

/**
 * §1.7.7's proposed contract. Orchestration lives in lib/exports/clean-contract.ts.
 *
 * `?preflight=1` returns the verdict as JSON without the file, so the associate
 * sees what could not be placed, and any refusal, before downloading.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const gate = await openExport(id);
  if (!gate.ok) return gate.response;

  const preflight = new URL(request.url).searchParams.get("preflight") === "1";
  return respondWithExport(await buildCleanContract(gate.ctx), { preflight });
}
