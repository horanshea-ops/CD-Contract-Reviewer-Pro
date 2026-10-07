import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-guard";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";
import { SET_COLUMNS } from "@/lib/standards/sets";

type Db = ReturnType<typeof createAdminClient>;

async function activeCount(db: Db, key: string): Promise<number> {
  const { count } = await db
    .from("standards")
    .select("id", { count: "exact", head: true })
    .eq("set_key", key)
    .is("retired_at", null);
  return count ?? 0;
}

/**
 * Switches a standards set on or off for reviews.
 *
 * A set that is off is never read: a review of that brand uses the default
 * set. Switching one on means every review of that brand reads its standards
 * and no others, so an empty set can't be switched on, and the default set
 * can't be switched off.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ key: string }> }) {
  const { admin: associate, denied } = await requireAdmin();
  if (denied) return denied;

  const { key } = await params;
  const body = await request.json().catch(() => ({}));
  if (typeof body.is_active !== "boolean") {
    return NextResponse.json({ error: "Say whether the set is on or off." }, { status: 400 });
  }

  const db = createAdminClient();
  const { data: set } = await db.from("standard_sets").select(SET_COLUMNS).eq("key", key).maybeSingle();
  if (!set) return NextResponse.json({ error: "That standards set doesn't exist." }, { status: 404 });

  if (set.is_default && !body.is_active) {
    return NextResponse.json({ error: `${set.name} is what every other review falls back to, so it stays on.` }, { status: 409 });
  }

  const standards = await activeCount(db, key);
  if (body.is_active && standards === 0) {
    return NextResponse.json({ error: `${set.name} has no standards yet. Add some before switching it on.` }, { status: 409 });
  }

  const { data, error } = await db
    .from("standard_sets")
    .update({ is_active: body.is_active, updated_by: associate.id, updated_at: new Date().toISOString() })
    .eq("key", key)
    .select(SET_COLUMNS)
    .maybeSingle();
  if (error || !data) return NextResponse.json({ error: "Could not save. Try again." }, { status: 500 });

  await logAudit({
    actorId: associate.id,
    action: body.is_active ? "standard_set_switched_on" : "standard_set_switched_off",
    entityType: "standard_set",
    metadata: { set_key: key, standards },
  });

  return NextResponse.json(data);
}

const COPIED =
  "clause_type, segment, category, position, fallback_language, walk_away_condition, severity_default, compromise_range, version, provenance";

/**
 * Fills an empty set with a copy of the default set's standards, as a
 * starting point for an admin to edit.
 *
 * Only a set with no standards at all takes a copy, removed ones included, so
 * nothing an admin wrote is ever overwritten. The copies carry no validation
 * stamp, since nobody has checked them against this brand's contract.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ key: string }> }) {
  const { admin: associate, denied } = await requireAdmin();
  if (denied) return denied;

  const { key } = await params;
  const db = createAdminClient();

  const { data: sets } = await db.from("standard_sets").select("key, name, is_default");
  const target = (sets ?? []).find((s) => s.key === key);
  const source = (sets ?? []).find((s) => s.is_default);
  if (!target) return NextResponse.json({ error: "That standards set doesn't exist." }, { status: 404 });
  if (!source || target.is_default) {
    return NextResponse.json({ error: "There is nothing to copy into this set." }, { status: 409 });
  }

  const { count } = await db.from("standards").select("id", { count: "exact", head: true }).eq("set_key", key);
  if ((count ?? 0) > 0) {
    return NextResponse.json({ error: `${target.name} already has standards. Edit or restore those instead.` }, { status: 409 });
  }

  const { data: originals, error: readError } = await db.from("standards").select(COPIED).eq("set_key", source.key).is("retired_at", null);
  if (readError || !originals?.length) return NextResponse.json({ error: "Could not read the standards to copy." }, { status: 500 });

  const now = new Date().toISOString();
  const { data, error } = await db
    .from("standards")
    .insert(
      // Each field is named, so a copy can never carry its original's id or history.
      originals.map((row) => ({
        clause_type: row.clause_type,
        segment: row.segment,
        category: row.category,
        position: row.position,
        fallback_language: row.fallback_language,
        walk_away_condition: row.walk_away_condition,
        severity_default: row.severity_default,
        compromise_range: row.compromise_range,
        version: row.version,
        set_key: key,

        // A validation was for the set it was made in.
        provenance: row.provenance === "cd_validated" ? "extracted" : row.provenance,
        validated_by: null,
        validated_at: null,
        updated_by: associate.id,
        updated_at: now,
      }))
    )
    .select();
  if (error || !data) return NextResponse.json({ error: "Could not copy the standards. Try again." }, { status: 500 });

  await logAudit({
    actorId: associate.id,
    action: "standard_set_copied",
    entityType: "standard_set",
    metadata: { set_key: key, copied_from: source.key, standards: data.length },
  });

  return NextResponse.json({ standards: data }, { status: 201 });
}
