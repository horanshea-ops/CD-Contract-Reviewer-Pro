import { NextResponse } from "next/server";
import { getCurrentAssociate } from "@/lib/current-associate";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";

const VALID_ACTIONS = ["accept", "edit", "dismiss"];

/**
 * Records an accept/edit/dismiss on one finding — the product's memory
 * (build brief §6). Dismissal is first-class (§13): it always captures a
 * reason, never just a click.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const associate = await getCurrentAssociate();
  if (!associate) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  const { id: findingId } = await params;
  const body = await request.json();
  const { action, editedLanguage, dismissalReason } = body as {
    action: string;
    editedLanguage?: string;
    dismissalReason?: string;
  };

  if (!VALID_ACTIONS.includes(action)) {
    return NextResponse.json({ error: "Invalid action." }, { status: 400 });
  }
  if (action === "edit" && !editedLanguage?.trim()) {
    return NextResponse.json({ error: "Edited language is required for an edit." }, { status: 400 });
  }
  if (action === "dismiss" && !dismissalReason?.trim()) {
    return NextResponse.json({ error: "A dismissal reason is required." }, { status: 400 });
  }

  const admin = createAdminClient();

  const { data: finding } = await admin
    .from("findings")
    .select("id, analysis_id, analyses!inner(associate_id)")
    .eq("id", findingId)
    .maybeSingle();

  if (!finding) {
    return NextResponse.json({ error: "Finding not found." }, { status: 404 });
  }

  const owningAssociateId = (finding as unknown as { analyses: { associate_id: string } }).analyses
    .associate_id;
  if (owningAssociateId !== associate.id && !associate.is_admin) {
    return NextResponse.json({ error: "Not authorized." }, { status: 403 });
  }

  const { data: actionRow, error } = await admin
    .from("finding_actions")
    .insert({
      finding_id: findingId,
      associate_id: associate.id,
      action,
      edited_language: action === "edit" ? editedLanguage : null,
      dismissal_reason: action === "dismiss" ? dismissalReason : null,
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: `Could not record action: ${error.message}` }, { status: 500 });
  }

  await logAudit({
    actorId: associate.id,
    action: `finding_${action}`,
    entityType: "finding",
    entityId: findingId,
    metadata: { analysis_id: finding.analysis_id, dismissal_reason: dismissalReason ?? null },
  });

  return NextResponse.json(actionRow);
}
