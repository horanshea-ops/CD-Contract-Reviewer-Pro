import { NextResponse } from "next/server";
import { getCurrentAssociate } from "@/lib/current-associate";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";
import { getEmailFindings } from "@/lib/email-drafting/input-assembly";
import { generateClientEmail } from "@/lib/anthropic";

/**
 * §1.8.2/§1.8.4/§1.8.6 — drafts a client email from this analysis's accepted
 * findings. Client audience only; the property-facing email (§1.8.3) is a
 * separate, Opus-gated piece of work with a hard field allowlist, not built
 * here. Never sends anything — this only generates and persists text, per
 * the standing "no sending from the tool" constraint.
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
    .select("id, associate_id, filename, status")
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

  const findings = await getEmailFindings(admin, id);
  if (findings.length === 0) {
    return NextResponse.json(
      { error: "No accepted findings yet — accept or edit at least one finding before drafting an email." },
      { status: 400 }
    );
  }

  const signatureBlock = associate.signature_block || `Best,\n${associate.name}`;

  let draft;
  try {
    draft = await generateClientEmail({
      findings,
      associateName: associate.name,
      contractLabel: analysis.filename,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not draft the email.";
    return NextResponse.json({ error: message }, { status: 500 });
  }

  const { data: inserted, error: insertError } = await admin
    .from("email_drafts")
    .insert({
      analysis_id: id,
      associate_id: associate.id,
      audience: "client",
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
    action: "client_email_drafted",
    entityType: "analysis",
    entityId: id,
    metadata: { email_draft_id: inserted.id, findings_included: findings.length, model_id: draft.model_id },
  });

  return NextResponse.json({ id: inserted.id, subject: inserted.subject, body: inserted.body, signatureBlock });
}
