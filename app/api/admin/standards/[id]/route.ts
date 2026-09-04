import { NextResponse } from "next/server";
import { getCurrentAssociate } from "@/lib/current-associate";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";

const EDITABLE_FIELDS = ["position", "fallback_language", "walk_away_condition", "severity_default", "provenance"];

/**
 * Edits one standards library entry. Admin-only — the library is CD's
 * negotiating playbook, not something every associate should be able to
 * browse or change (per explicit product decision, not just the build
 * brief). Checked server-side, not just by hiding the nav link.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const associate = await getCurrentAssociate();
  if (!associate) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }
  if (!associate.is_admin) {
    return NextResponse.json({ error: "Admin access required." }, { status: 403 });
  }

  const { id } = await params;
  const body = await request.json();

  const updates: Record<string, unknown> = {};
  for (const field of EDITABLE_FIELDS) {
    if (field in body) updates[field] = body[field];
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "No editable fields provided." }, { status: 400 });
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
    metadata: { clause_type: data.clause_type, fields_changed: Object.keys(updates) },
  });

  return NextResponse.json(data);
}
