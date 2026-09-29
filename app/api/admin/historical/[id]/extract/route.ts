import { NextResponse, after } from "next/server";
import { requireAdmin } from "@/lib/admin-guard";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";
import { extractHistoricalTerms } from "@/lib/historical/extract";
import { historicalExtractionEnabled } from "@/lib/historical/types";

export const maxDuration = 600;

/**
 * Reads a historical contract's terms again, after a failure, or after an
 * admin chooses to go ahead with a contract that restricts AI-assisted review.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { admin: actor, denied } = await requireAdmin();
  if (denied) return denied;
  if (!historicalExtractionEnabled()) {
    return NextResponse.json({ error: "Reading terms from historical contracts is switched off." }, { status: 409 });
  }

  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const db = createAdminClient();
  const { data: row } = await db.from("historical_contracts").select("id, extraction_status").eq("id", id).maybeSingle();
  if (!row) return NextResponse.json({ error: "Contract not found." }, { status: 404 });
  if (row.extraction_status === "pending") return NextResponse.json({ error: "Its terms are already being read." }, { status: 409 });

  const aiClauseAcknowledged = row.extraction_status === "blocked_ai_clause" && body.proceed === true;
  if (row.extraction_status === "blocked_ai_clause" && !aiClauseAcknowledged) {
    return NextResponse.json({ error: "This contract restricts AI-assisted review. Confirm to go ahead." }, { status: 409 });
  }
  if (aiClauseAcknowledged) {
    await logAudit({ actorId: actor.id, action: "ai_clause_scan_overridden", entityType: "historical_contract", entityId: id });
  }

  await db.from("historical_contracts").update({ extraction_status: "pending" }).eq("id", id);
  after(() => extractHistoricalTerms(id, actor.id, { aiClauseAcknowledged }));

  return NextResponse.json({ id, extraction_status: "pending" });
}
