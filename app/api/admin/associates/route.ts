import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-guard";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";
import { normalizeEmail } from "@/lib/associates";

/**
 * Adds an associate. The new row is their place on the sign-in allowlist, so
 * they can sign in at the login page straight away. No email is sent.
 */
export async function POST(request: Request) {
  const { admin: actor, denied } = await requireAdmin();
  if (denied) return denied;

  const body = await request.json().catch(() => ({}));
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const email = normalizeEmail(body.email);
  const is_admin = body.is_admin === true;

  if (!name) return NextResponse.json({ error: "Enter their name." }, { status: 400 });
  if (!email) return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });

  const db = createAdminClient();
  const { data: existing } = await db.from("associates").select("id, status").eq("email", email).maybeSingle();
  if (existing) {
    const error =
      existing.status === "revoked"
        ? "This email belongs to a revoked associate. Restore their access instead."
        : "This email already belongs to an associate.";
    return NextResponse.json({ error }, { status: 409 });
  }

  const { data, error } = await db
    .from("associates")
    .insert({ name, email, is_admin, status: "active" })
    .select("id, name, email, is_admin, status, created_at")
    .single();
  if (error) return NextResponse.json({ error: "Could not add the associate. Try again." }, { status: 500 });

  await logAudit({
    actorId: actor.id,
    action: "associate_added",
    entityType: "associate",
    entityId: data.id,
    metadata: { email, is_admin },
  });

  return NextResponse.json(data, { status: 201 });
}
