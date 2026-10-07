import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-guard";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";
import { clauseKey, isCategory, isLibrarySeverity } from "@/lib/standards/keys";
import { DEFAULT_SET, isSetKey } from "@/lib/standards/sets";
import { STANDARDS_LIBRARY_VERSION } from "@/lib/standards/v1";

const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");

/**
 * Adds a standard to one set of the library. An admin writes it, so it arrives
 * validated by that admin. It reaches the model from the next review that
 * reads that set.
 */
export async function POST(request: Request) {
  const { admin: associate, denied } = await requireAdmin();
  if (denied) return denied;

  const body = await request.json().catch(() => ({}));
  const clause_type = clauseKey(text(body.name));
  const position = text(body.position);
  const fallback_language = text(body.fallback_language);
  const walk_away_condition = text(body.walk_away_condition);
  const severity_default = body.severity_default;
  const category = body.category ?? "business";
  const compromise_range = text(body.compromise_range);
  const set_key = body.set_key ?? DEFAULT_SET;

  if (!clause_type) return NextResponse.json({ error: "Give the clause a name." }, { status: 400 });
  if (!position) return NextResponse.json({ error: "Write the position." }, { status: 400 });
  if (!isCategory(category)) return NextResponse.json({ error: "Choose a category." }, { status: 400 });

  // Only business standards propose wording, so only they need it.
  if (category === "business" && !fallback_language) {
    return NextResponse.json({ error: "Write the fallback language." }, { status: 400 });
  }
  if (!isLibrarySeverity(severity_default)) return NextResponse.json({ error: "Choose a severity." }, { status: 400 });

  if (!isSetKey(set_key)) return NextResponse.json({ error: "Choose a standards set." }, { status: 400 });

  const db = createAdminClient();

  const { data: set } = await db.from("standard_sets").select("key").eq("key", set_key).maybeSingle();
  if (!set) return NextResponse.json({ error: "That standards set doesn't exist." }, { status: 404 });

  // The same clause can have a standard in every set, and one in each.
  const { data: existing, error: readError } = await db
    .from("standards")
    .select("id, retired_at")
    .eq("set_key", set_key)
    .eq("clause_type", clause_type)
    .eq("segment", "default");
  if (readError) return NextResponse.json({ error: "Could not check the library. Try again." }, { status: 500 });
  if (existing?.some((row) => row.retired_at)) {
    return NextResponse.json(
      { error: "A removed standard already has this name. Restore it from Removed standards instead." },
      { status: 409 }
    );
  }
  if (existing?.length) {
    return NextResponse.json({ error: "A standard with this name already exists." }, { status: 409 });
  }

  // Every row shares one version string. Read it rather than assume it.
  const { data: sample } = await db.from("standards").select("version").limit(1).maybeSingle();
  const now = new Date().toISOString();

  const { data, error } = await db
    .from("standards")
    .insert({
      set_key,
      clause_type,
      segment: "default",
      category,
      position,
      fallback_language,
      walk_away_condition,
      severity_default,
      compromise_range: category === "business" ? compromise_range : "",
      version: sample?.version ?? STANDARDS_LIBRARY_VERSION,
      provenance: "cd_validated",
      validated_by: associate.id,
      validated_at: now,
      updated_by: associate.id,
      updated_at: now,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: "Could not add the standard. Try again." }, { status: 500 });

  await logAudit({
    actorId: associate.id,
    action: "standard_added",
    entityType: "standard",
    entityId: data.id,
    metadata: { set_key, clause_type, category, severity_default },
  });

  return NextResponse.json(data, { status: 201 });
}
