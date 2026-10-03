import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-guard";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";
import { parseDetailEdits } from "@/lib/historical/fields";
import { HISTORICAL_BUCKET, LIST_COLUMNS } from "@/lib/historical/types";

/** Corrects a historical contract's details. An edited detail is marked as the admin's. */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { admin: actor, denied } = await requireAdmin();
  if (denied) return denied;

  const { id } = await params;
  const parsed = parseDetailEdits(await request.json().catch(() => ({})));
  if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });

  const db = createAdminClient();
  const { data: row } = await db.from("historical_contracts").select("details_checked").eq("id", id).maybeSingle();
  if (!row) return NextResponse.json({ error: "Contract not found." }, { status: 404 });

  const provenance: Record<string, string> = { ...(row.details_checked ?? {}) };
  for (const field of Object.keys(parsed.edits)) provenance[field] = "edited";

  const { data, error } = await db
    .from("historical_contracts")
    .update({ ...parsed.edits, details_checked: provenance })
    .eq("id", id)
    .select(LIST_COLUMNS)
    .maybeSingle();
  if (error || !data) return NextResponse.json({ error: "Couldn't save. Try again." }, { status: 500 });

  await logAudit({
    actorId: actor.id,
    action: "historical_contract_edited",
    entityType: "historical_contract",
    entityId: id,
    metadata: { fields: Object.keys(parsed.edits) },
  });

  return NextResponse.json(data);
}

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
  if (error) return NextResponse.json({ error: "Couldn't remove the contract. Try again." }, { status: 500 });
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
