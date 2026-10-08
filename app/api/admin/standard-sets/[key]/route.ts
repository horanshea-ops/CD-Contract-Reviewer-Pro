import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-guard";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";
import { brandKey } from "@/lib/intake/brands";
import { SET_COLUMNS, type StandardSet } from "@/lib/standards/sets";

type Db = ReturnType<typeof createAdminClient>;

async function activeCount(db: Db, key: string): Promise<number> {
  const { count } = await db
    .from("standards")
    .select("id", { count: "exact", head: true })
    .eq("set_key", key)
    .is("retired_at", null);
  return count ?? 0;
}

const MAX_BRAND_CHARS = 80;
const MAX_BRANDS = 60;

/**
 * Replaces the list of brands a set covers.
 *
 * The list alone decides which hotels' reviews read the set, so it is kept
 * unambiguous: a brand sits on one list, the set's own name stays on its own
 * list, and the default set has none because it takes every other hotel. A
 * change reaches negotiations started afterwards. One already open keeps the
 * set it started with.
 */
async function changeBrands(db: Db, associateId: string, set: StandardSet, value: unknown) {
  if (!Array.isArray(value) || value.some((name) => typeof name !== "string")) {
    return NextResponse.json({ error: "Send the brands as a list of names." }, { status: 400 });
  }
  if (set.is_default) {
    return NextResponse.json({ error: `${set.name} covers every hotel not listed under another set, so it has no list.` }, { status: 409 });
  }

  // One entry per brand, in the order given, however it was spelled or spaced.
  const names: string[] = [];
  for (const raw of value as string[]) {
    const name = raw.replace(/\s+/g, " ").trim();
    if (!name || names.some((kept) => brandKey(kept) === brandKey(name))) continue;
    if (name.length > MAX_BRAND_CHARS) {
      return NextResponse.json({ error: `A brand name can be ${MAX_BRAND_CHARS} characters at most.` }, { status: 400 });
    }
    names.push(name);
  }
  if (names.length > MAX_BRANDS) {
    return NextResponse.json({ error: `A set can list ${MAX_BRANDS} brands at most.` }, { status: 400 });
  }
  if (!names.some((name) => brandKey(name) === brandKey(set.name))) {
    return NextResponse.json({ error: `${set.name} is the set's own name, so it stays on the list.` }, { status: 409 });
  }

  const { data: all } = await db.from("standard_sets").select(SET_COLUMNS);
  for (const other of ((all ?? []) as StandardSet[]).filter((row) => row.key !== set.key)) {
    const taken = names.find((name) => [other.name, ...other.brand_names].some((theirs) => brandKey(theirs) === brandKey(name)));
    if (taken) {
      const why = other.is_default ? `${other.name} is the set for every other hotel, so it can't be listed.` : `${taken} is already listed under ${other.name}.`;
      return NextResponse.json({ error: why }, { status: 409 });
    }
  }

  const { data, error } = await db
    .from("standard_sets")
    .update({ brand_names: names, updated_by: associateId, updated_at: new Date().toISOString() })
    .eq("key", set.key)
    .select(SET_COLUMNS)
    .maybeSingle();
  if (error || !data) return NextResponse.json({ error: "Could not save. Try again." }, { status: 500 });

  await logAudit({
    actorId: associateId,
    action: "standard_set_brands_changed",
    entityType: "standard_set",
    metadata: { set_key: set.key, before: set.brand_names, after: names },
  });

  return NextResponse.json(data);
}

/**
 * Switches a standards set on or off for reviews, or replaces the list of
 * brands it covers when the request carries `brand_names`.
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
  const changesBrands = body.brand_names !== undefined;
  if (!changesBrands && typeof body.is_active !== "boolean") {
    return NextResponse.json({ error: "Say whether the set is on or off." }, { status: 400 });
  }

  const db = createAdminClient();
  const { data: set } = await db.from("standard_sets").select(SET_COLUMNS).eq("key", key).maybeSingle();
  if (!set) return NextResponse.json({ error: "That standards set doesn't exist." }, { status: 404 });

  if (changesBrands) return changeBrands(db, associate.id, set as StandardSet, body.brand_names);

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
