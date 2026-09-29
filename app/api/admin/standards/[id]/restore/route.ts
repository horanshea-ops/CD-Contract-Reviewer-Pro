import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-guard";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";

/** Puts a removed standard back in the library. It reaches the model from the next review on. */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { admin: associate, denied } = await requireAdmin();
  if (denied) return denied;

  const { id } = await params;
  const now = new Date().toISOString();
  const { data, error } = await createAdminClient()
    .from("standards")
    .update({ retired_at: null, retired_by: null, updated_by: associate.id, updated_at: now })
    .eq("id", id)
    .not("retired_at", "is", null)
    .select()
    .maybeSingle();

  if (error) return NextResponse.json({ error: "Could not restore the standard. Try again." }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Standard not found, or not removed." }, { status: 404 });

  await logAudit({
    actorId: associate.id,
    action: "standard_restored",
    entityType: "standard",
    entityId: id,
    metadata: { clause_type: data.clause_type },
  });

  return NextResponse.json(data);
}
