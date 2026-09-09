import { NextResponse } from "next/server";
import { getCurrentAssociate } from "@/lib/current-associate";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";
import { getPropertyEmailItems } from "@/lib/email-drafting/property-assembly";
import { generatePropertyEmail } from "@/lib/anthropic";

/**
 * §1.8.3 — drafts the cover email that goes to the property with the redline.
 * Separate from the client route on purpose: the client email carries CD's
 * reasoning and exposure figures, and this one must carry none of it. The
 * allowlist lives in lib/email-drafting/property-assembly.ts.
 *
 * Never sends anything — this only generates and persists text, per the
 * standing "no sending from the tool" constraint.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const associate = await getCurrentAssociate();
  if (!associate) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  const { id } = await params;
  const admin = createAdminClient();

  const { data: analysis } = await admin
    .from("analyses")
    .select("id, associate_id, status, thread_id")
    .eq("id", id)
    .maybeSingle();

  if (!analysis) {
    return NextResponse.json({ error: "Analysis not found." }, { status: 404 });
  }
  if (analysis.associate_id !== associate.id && !associate.is_admin) {
    return NextResponse.json({ error: "Not authorized to draft an email for this analysis." }, { status: 403 });
  }
  if (analysis.status !== "complete") {
    return NextResponse.json({ error: "Analysis isn't complete yet." }, { status: 400 });
  }

  const items = await getPropertyEmailItems(admin, id);

  // Nothing accepted means there is no redline, so there is no document for
  // this email to transmit. The client route drafts a "no changes" note in the
  // same situation; here that would describe an attachment that doesn't exist.
  if (items.length === 0) {
    return NextResponse.json(
      { error: "No accepted changes, so there's no redline to send. Accept or edit a finding first." },
      { status: 400 }
    );
  }

  // The property's own name, never the filename. A CD filename can carry
  // internal shorthand about the deal, which is the same leak the field
  // allowlist exists to prevent.
  let propertyLabel = "the agreement";
  if (analysis.thread_id) {
    const { data: thread } = await admin
      .from("negotiation_threads")
      .select("property_name")
      .eq("id", analysis.thread_id)
      .maybeSingle();
    if (thread?.property_name) propertyLabel = thread.property_name;
  }

  let draft;
  try {
    draft = await generatePropertyEmail({ items, propertyLabel });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not draft the email.";
    return NextResponse.json({ error: message }, { status: 500 });
  }

  const { data: inserted, error: insertError } = await admin
    .from("email_drafts")
    .insert({
      analysis_id: id,
      associate_id: associate.id,
      audience: "property",
      subject: draft.subject,
      body: draft.body,
      edited_by_associate: false,
    })
    .select("id, subject, body, created_at")
    .single();

  if (insertError) {
    return NextResponse.json({ error: `Could not save the draft: ${insertError.message}` }, { status: 500 });
  }

  await logAudit({
    actorId: associate.id,
    action: "property_email_drafted",
    entityType: "analysis",
    entityId: id,
    metadata: { email_draft_id: inserted.id, items_included: items.length, model_id: draft.model_id },
  });

  const signatureBlock = associate.signature_block || `Best,\n${associate.name}`;
  return NextResponse.json({ id: inserted.id, subject: inserted.subject, body: inserted.body, signatureBlock });
}
