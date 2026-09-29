import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-guard";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";
import { LIST_COLUMNS } from "@/lib/historical/types";

/**
 * Puts a contract back in line to be read: one whose reading failed, or one
 * that restricts AI-assisted review once an admin chooses to go ahead.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { admin: actor, denied } = await requireAdmin();
  if (denied) return denied;

  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const db = createAdminClient();
  const { data: row } = await db.from("historical_contracts").select("id, extraction_status").eq("id", id).maybeSingle();
  if (!row) return NextResponse.json({ error: "Contract not found." }, { status: 404 });

  if (row.extraction_status === "blocked_ai_clause") {
    if (body.proceed !== true) {
      return NextResponse.json({ error: "This contract restricts AI-assisted review. Confirm to go ahead." }, { status: 409 });
    }
    await logAudit({ actorId: actor.id, action: "ai_clause_scan_overridden", entityType: "historical_contract", entityId: id });
  } else if (row.extraction_status !== "failed") {
    return NextResponse.json({ error: "Only a failed or held contract can be sent again." }, { status: 409 });
  }

  const { data } = await db
    .from("historical_contracts")
    .update({ extraction_status: "waiting", batch_id: null })
    .eq("id", id)
    .select(LIST_COLUMNS)
    .maybeSingle();
  return NextResponse.json(data);
}
