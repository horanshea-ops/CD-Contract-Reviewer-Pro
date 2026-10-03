import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-guard";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";
import { isCategory, isLibrarySeverity } from "@/lib/standards/keys";

const EDITABLE_FIELDS = [
  "category",
  "position",
  "fallback_language",
  "walk_away_condition",
  "severity_default",
  "compromise_range",
  "provenance",
];
const TEXT_FIELDS = ["position", "fallback_language", "walk_away_condition", "compromise_range"];

/**
 * Edits one standards library entry. Admin-only — the library is CD's
 * negotiating playbook, not something every associate should be able to
 * browse or change (per explicit product decision, not just the build
 * brief). Checked server-side, not just by hiding the nav link.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { admin: associate, denied } = await requireAdmin();
  if (denied) return denied;

  const { id } = await params;
  const body = await request.json();

  const updates: Record<string, unknown> = {};
  for (const field of EDITABLE_FIELDS) {
    if (field in body) updates[field] = body[field];
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "No editable fields provided." }, { status: 400 });
  }
  if ("severity_default" in updates && !isLibrarySeverity(updates.severity_default)) {
    return NextResponse.json({ error: "Choose a severity." }, { status: 400 });
  }
  if ("category" in updates && !isCategory(updates.category)) {
    return NextResponse.json({ error: "Choose a category." }, { status: 400 });
  }
  for (const field of TEXT_FIELDS) {
    if (field in updates && typeof updates[field] !== "string") {
      return NextResponse.json({ error: "Text fields must be text." }, { status: 400 });
    }
  }

  const admin = createAdminClient();

  // provenance is load-bearing (build brief section 7 / section 14) — only a
  // deliberate edit stamps who validated it and when. Changing away from
  // cd_validated clears that stamp rather than leaving a stale claim.
  if (updates.provenance === "cd_validated") {
    updates.validated_by = associate.id;
    updates.validated_at = new Date().toISOString();
  } else if (updates.provenance) {
    updates.validated_by = null;
    updates.validated_at = null;
  }

  updates.updated_by = associate.id;
  updates.updated_at = new Date().toISOString();

  const { data, error } = await admin.from("standards").update(updates).eq("id", id).select().maybeSingle();

  if (error) {
    return NextResponse.json({ error: `Could not save: ${error.message}` }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "Standard not found." }, { status: 404 });
  }

  await logAudit({
    actorId: associate.id,
    action: "standard_updated",
    entityType: "standard",
    entityId: id,
    metadata: {
      clause_type: data.clause_type,
      fields_changed: Object.keys(updates),
      ...("severity_default" in body ? { severity_default: data.severity_default } : {}),
      ...("category" in body ? { category: data.category } : {}),
    },
  });

  return NextResponse.json(data);
}

/**
 * Removes a standard by retiring it. The row stays, so reviews that quoted it
 * keep their history, and it can be restored. It stops reaching the model.
 */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { admin: associate, denied } = await requireAdmin();
  if (denied) return denied;

  const { id } = await params;
  const db = createAdminClient();

  const { count } = await db.from("standards").select("id", { count: "exact", head: true }).is("retired_at", null);
  if ((count ?? 0) <= 1) {
    return NextResponse.json({ error: "The library needs at least one standard." }, { status: 409 });
  }

  const now = new Date().toISOString();
  const { data, error } = await db
    .from("standards")
    .update({ retired_at: now, retired_by: associate.id, updated_by: associate.id, updated_at: now })
    .eq("id", id)
    .is("retired_at", null)
    .select()
    .maybeSingle();

  if (error) return NextResponse.json({ error: "Could not remove the standard. Try again." }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Standard not found, or already removed." }, { status: 404 });

  await logAudit({
    actorId: associate.id,
    action: "standard_retired",
    entityType: "standard",
    entityId: id,
    metadata: { clause_type: data.clause_type },
  });

  return NextResponse.json(data);
}
