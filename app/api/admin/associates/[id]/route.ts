import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-guard";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";
import { changeBlocked, type AssociateRow } from "@/lib/associates";

const COLUMNS = "id, name, email, is_admin, status, created_at";

/**
 * Renames an associate, changes their admin flag, or revokes or restores
 * their access. A revoked associate is signed out on their next page load,
 * because every request checks their status. The email can't change: it is
 * how sign-in finds them.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { admin: actor, denied } = await requireAdmin();
  if (denied) return denied;

  const { id } = await params;
  const body = await request.json().catch(() => ({}));

  const updates: Partial<Pick<AssociateRow, "name" | "is_admin" | "status">> = {};
  if ("name" in body) {
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) return NextResponse.json({ error: "Enter their name." }, { status: 400 });
    updates.name = name;
  }
  if ("is_admin" in body) {
    if (typeof body.is_admin !== "boolean") return NextResponse.json({ error: "Choose a role." }, { status: 400 });
    updates.is_admin = body.is_admin;
  }
  if ("status" in body) {
    if (body.status !== "active" && body.status !== "revoked") {
      return NextResponse.json({ error: "Choose active or revoked." }, { status: 400 });
    }
    updates.status = body.status;
  }
  if (Object.keys(updates).length === 0) return NextResponse.json({ error: "Nothing to change." }, { status: 400 });

  const db = createAdminClient();
  const { data: everyone } = await db.from("associates").select(COLUMNS);
  const target = (everyone ?? []).find((a) => a.id === id) as AssociateRow | undefined;
  if (!target) return NextResponse.json({ error: "Associate not found." }, { status: 404 });

  const blocked = changeBlocked(actor.id, target, updates, (everyone ?? []) as AssociateRow[]);
  if (blocked) return NextResponse.json({ error: blocked }, { status: 409 });

  const { data, error } = await db.from("associates").update(updates).eq("id", id).select(COLUMNS).maybeSingle();
  if (error || !data) return NextResponse.json({ error: "Could not save the change. Try again." }, { status: 500 });

  await logAudit({
    actorId: actor.id,
    action: "associate_updated",
    entityType: "associate",
    entityId: id,
    metadata: { email: target.email, changes: updates },
  });

  return NextResponse.json(data);
}
