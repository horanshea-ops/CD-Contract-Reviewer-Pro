import { NextResponse } from "next/server";
import { getCurrentAssociate } from "@/lib/current-associate";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkDocument, pictureNotes } from "@/lib/document-checks";
import { toNotes, withoutRepeats } from "@/lib/document-notes";
import { dryRunFor, type DryRunRow } from "@/lib/exports/dry-run";
import { withoutArchivedExposure } from "@/lib/exposures/enabled";
import { latestActions } from "@/lib/finding-actions";
import { previewFindings } from "@/lib/redline-engine/preflight";

const STORAGE_BUCKET = "contracts";
const SIGNED_URL_TTL_SECONDS = 60 * 10;

/**
 * The set of standards a review read, by name, and why when it isn't the set
 * its negotiation asked for. Asked for separately, so a review from before
 * sets, or a database without them yet, still opens. Null then.
 */
async function standardsUsed(admin: ReturnType<typeof createAdminClient>, analysisId: string) {
  const { data: row } = await admin.from("analyses").select("standards_set, standards_set_note").eq("id", analysisId).maybeSingle();
  if (!row?.standards_set) return null;

  const { data: set } = await admin.from("standard_sets").select("name").eq("key", row.standards_set).maybeSingle();
  return { name: (set?.name as string | undefined) ?? row.standards_set, note: (row.standards_set_note as string | null) ?? null };
}

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
      "id, associate_id, client_id, filename, storage_path, original_storage_path, source_format, status, error, created_at, started_at, completed_at, model_id, library_version, intake_route, intake_health, had_existing_revisions, existing_revision_authors, existing_revision_count, ai_clause_scan_result, ai_clause_acknowledged_at, thread_id, round_number, document_notes, accepted_view_text, negotiation_threads(property_name)"
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
  // Why the Word redline would be discarded for the marked-up PDF, known before anyone exports.
  let redlineFallback: string | null = null;
  if (analysis.status === "complete" || analysis.status === "failed") {
    const { data: findingRows } = await admin
      .from("findings")
      .select("*")
      .eq("analysis_id", id)
      .order("severity", { ascending: true });

    const latestActionByFinding = await latestActions(
      admin,
      (findingRows ?? []).map((f) => f.id)
    );
    const withActions = (findingRows ?? []).map((f) => ({
      ...f,
      current_action: latestActionByFinding.get(f.id) ?? null,
    }));

    // A Word upload's cards are told what the redline will do by the redline engine itself.
    const check = await dryRunFor(admin, analysis, withActions as DryRunRow[]);
    if (check) {
      redlineFallback = check.fallbackReason;
      findings = withActions.map((f) => ({ ...withoutArchivedExposure(f), placement: check.verdicts.get(f.id) ?? null }));
    } else {
      // A PDF or .doc upload has no Word file to check, so its cards read the review's text.
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
      findings = withActions.map((f) => ({ ...withoutArchivedExposure(f), ...previews.get(f.id) }));
    }
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

  return NextResponse.json({
    ...analysisFields,
    // Read above for the check, and of no use to the page.
    original_storage_path: undefined,
    document_notes,
    propertyName,
    findings,
    redline_fallback: redlineFallback,
    documentUrl,
    document_checks,
    standards: await standardsUsed(admin, id),
  });
}
