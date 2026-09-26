import { NextResponse } from "next/server";
import { getCurrentAssociate } from "@/lib/current-associate";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkDocument, pictureNotes } from "@/lib/document-checks";
import { toNotes, withoutRepeats } from "@/lib/document-notes";
import { previewFindings } from "@/lib/redline-engine/preflight";

const STORAGE_BUCKET = "contracts";
const SIGNED_URL_TTL_SECONDS = 60 * 10;

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const associate = await getCurrentAssociate();
  if (!associate) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  const { id } = await params;
  const admin = createAdminClient();

  const { data: analysis, error } = await admin
    .from("analyses")
    .select(
      "id, associate_id, client_id, filename, storage_path, source_format, status, error, created_at, started_at, completed_at, model_id, library_version, intake_route, intake_health, had_existing_revisions, existing_revision_authors, existing_revision_count, ai_clause_scan_result, ai_clause_acknowledged_at, thread_id, round_number, document_notes, accepted_view_text, negotiation_threads(property_name)"
    )
    .eq("id", id)
    .maybeSingle();

  if (error || !analysis) {
    return NextResponse.json({ error: "Analysis not found." }, { status: 404 });
  }

  if (analysis.associate_id !== associate.id && !associate.is_admin) {
    return NextResponse.json({ error: "Not authorized to view this analysis." }, { status: 403 });
  }

  let findings: unknown[] = [];
  if (analysis.status === "complete" || analysis.status === "failed") {
    const { data: findingRows } = await admin
      .from("findings")
      .select("*")
      .eq("analysis_id", id)
      .order("severity", { ascending: true });

    const findingIds = (findingRows ?? []).map((f) => f.id);
    const { data: actionRows } = findingIds.length
      ? await admin
          .from("finding_actions")
          .select("finding_id, action, edited_language, dismissal_reason, created_at")
          .in("finding_id", findingIds)
          .order("created_at", { ascending: false })
      : { data: [] };

    type ActionRow = {
      finding_id: string;
      action: string;
      edited_language: string | null;
      dismissal_reason: string | null;
      created_at: string;
    };
    const latestActionByFinding = new Map<string, ActionRow>();
    for (const row of (actionRows ?? []) as ActionRow[]) {
      if (!latestActionByFinding.has(row.finding_id)) {
        latestActionByFinding.set(row.finding_id, row);
      }
    }

    const withActions = (findingRows ?? []).map((f) => ({
      ...f,
      current_action: latestActionByFinding.get(f.id) ?? null,
    }));

    // What the redline would do with each change, so a card can say so before export.
    const previews = previewFindings(
      withActions.map((f) => ({
        id: f.id,
        quoted_text: f.quoted_text,
        is_missing_clause: f.is_missing_clause,
        language:
          f.current_action?.action === "edit" && f.current_action.edited_language
            ? f.current_action.edited_language
            : f.proposed_language,
      })),
      analysis.accepted_view_text
    );
    findings = withActions.map((f) => ({ ...f, ...previews.get(f.id) }));
  }

  let documentUrl: string | null = null;
  const { data: signed } = await admin.storage
    .from(STORAGE_BUCKET)
    .createSignedUrl(analysis.storage_path, SIGNED_URL_TTL_SECONDS);
  documentUrl = signed?.signedUrl ?? null;

  // The contract text is only read here, never sent to the page.
  const { negotiation_threads, accepted_view_text, ...analysisFields } = analysis;
  const propertyName = (negotiation_threads as unknown as { property_name: string } | null)?.property_name ?? null;
  const document_checks =
    analysis.status === "complete"
      ? [...pictureNotes((analysis.intake_health as { pictures?: { near: string }[] } | null)?.pictures), ...checkDocument(accepted_view_text)]
      : [];
  const document_notes = withoutRepeats(toNotes(analysis.document_notes), document_checks);

  return NextResponse.json({ ...analysisFields, document_notes, propertyName, findings, documentUrl, document_checks });
}
