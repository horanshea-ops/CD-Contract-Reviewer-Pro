import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-guard";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";
import { HISTORICAL_BUCKET } from "@/lib/historical/types";

/** Removes a historical contract, its stored file and its terms. */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { admin: actor, denied } = await requireAdmin();
  if (denied) return denied;

  const { id } = await params;
  const db = createAdminClient();
  const { data: row } = await db.from("historical_contracts").select("id, storage_path, hotel_name, file_name").eq("id", id).maybeSingle();
  if (!row) return NextResponse.json({ error: "Contract not found." }, { status: 404 });

  // Terms go with the row (on delete cascade).
  const { error } = await db.from("historical_contracts").delete().eq("id", id);
  if (error) return NextResponse.json({ error: "Could not remove the contract. Try again." }, { status: 500 });
  await db.storage.from(HISTORICAL_BUCKET).remove([row.storage_path]);

  await logAudit({
    actorId: actor.id,
    action: "historical_contract_removed",
    entityType: "historical_contract",
    entityId: id,
    metadata: { hotel_name: row.hotel_name, file_name: row.file_name },
  });

  return NextResponse.json({ removed: id });
}
