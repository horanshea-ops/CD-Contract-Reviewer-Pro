import { NextResponse } from "next/server";
import { getCurrentAssociate } from "@/lib/current-associate";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";
import { noteProblem } from "@/lib/redline-comments/note-guard";

/**
 * Sets the associate's version of a finding's redline comment (CLAUDE.md
 * deviation 8). The comment reaches the property, so the same content check
 * the model's note passed runs here too, with CD's own text on the finding to
 * check against.
 *
 * `note: null` goes back to the model's note. An empty note means no comment.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const associate = await getCurrentAssociate();
  if (!associate) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  const { id: findingId } = await params;
  const body = (await request.json()) as { note?: unknown };
  if (body.note !== null && typeof body.note !== "string") {
    return NextResponse.json({ error: "A comment must be text." }, { status: 400 });
  }
  const note = body.note === null ? null : body.note.replace(/\s+/g, " ").trim();

  const admin = createAdminClient();
  const { data: finding } = await admin
    .from("findings")
    .select("id, analysis_id, category, cd_standard, finding_text, compromise_range, analyses!inner(associate_id)")
    .eq("id", findingId)
    .maybeSingle();

  if (!finding) {
    return NextResponse.json({ error: "Finding not found." }, { status: 404 });
  }

  const owningAssociateId = (finding as unknown as { analyses: { associate_id: string } }).analyses.associate_id;
  if (owningAssociateId !== associate.id && !associate.is_admin) {
    return NextResponse.json({ error: "Not authorized." }, { status: 403 });
  }

  if (finding.category === "legal") {
    return NextResponse.json({ error: "Legal findings never reach the redline, so they take no comment." }, { status: 400 });
  }

  const problem = note ? noteProblem(note, finding) : null;
  if (problem) {
    return NextResponse.json({ error: problem }, { status: 400 });
  }

  const { error } = await admin.from("findings").update({ edited_redline_note: note }).eq("id", findingId);
  if (error) {
    return NextResponse.json({ error: `Could not save the comment: ${error.message}` }, { status: 500 });
  }

  await logAudit({
    actorId: associate.id,
    action: "finding_redline_note_edited",
    entityType: "finding",
    entityId: findingId,
    metadata: { analysis_id: finding.analysis_id, change: note === null ? "reset" : note ? "edited" : "cleared" },
  });

  return NextResponse.json({ edited_redline_note: note });
}
