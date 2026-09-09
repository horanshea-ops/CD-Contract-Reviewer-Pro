import { NextResponse } from "next/server";
import { getCurrentAssociate } from "@/lib/current-associate";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";

/**
 * §1.8.5/§1.8.6 — records an associate's inline edit to a drafted email.
 * Never sends anything; this is a plain content update.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const associate = await getCurrentAssociate();
  if (!associate) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  const { id } = await params;
  const body = await request.json().catch(() => null);
  const subject = typeof body?.subject === "string" ? body.subject : undefined;
  const draftBody = typeof body?.body === "string" ? body.body : undefined;
  if (subject === undefined && draftBody === undefined) {
    return NextResponse.json({ error: "Nothing to update." }, { status: 400 });
  }

  const admin = createAdminClient();

  const { data: draft } = await admin.from("email_drafts").select("id, associate_id").eq("id", id).maybeSingle();
  if (!draft) {
    return NextResponse.json({ error: "Draft not found." }, { status: 404 });
  }
  if (draft.associate_id !== associate.id && !associate.is_admin) {
    return NextResponse.json({ error: "Not authorized to edit this draft." }, { status: 403 });
  }

  const { error: updateError } = await admin
    .from("email_drafts")
    .update({
      ...(subject !== undefined && { subject }),
      ...(draftBody !== undefined && { body: draftBody }),
      edited_by_associate: true,
    })
    .eq("id", id);

  if (updateError) {
    return NextResponse.json({ error: `Could not save the edit: ${updateError.message}` }, { status: 500 });
  }

  await logAudit({
    actorId: associate.id,
    action: "client_email_edited",
    entityType: "email_draft",
    entityId: id,
    metadata: {},
  });

  return NextResponse.json({ ok: true });
}
