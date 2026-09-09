import { NextResponse } from "next/server";
import { getCurrentAssociate } from "@/lib/current-associate";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";
import { getActionedFindings } from "@/lib/get-actioned-findings";
import { generateRedline } from "@/lib/redline-engine";
import { UNAPPLIED_REASON_TEXT, validateRedline } from "@/lib/redline-validation";
import { recordExport, recordResolutions } from "@/lib/export-log";

const STORAGE_BUCKET = "contracts";

/**
 * Tracked-changes DOCX export — real Word `w:ins`/`w:del` revision marks on
 * the original uploaded document. DOCX-sourced analyses only: there's no
 * Word document to inject revisions into for PDF- or DOC-sourced ones (see
 * docs/redline-export-plan.md for why).
 *
 * Nothing is streamed until the oracle has passed it (MASTER_PLAN.md §1.6).
 * Three outcomes, never all-or-nothing:
 *
 *   clean     every finding applied, validation passed — deliver the .docx
 *   partial   some refused, validation passed — deliver it, with the list
 *   fallback  validation failed — discard the file, route to the marked-up PDF
 *
 * `?preflight=1` returns the verdict as JSON without the file, so the associate
 * sees what could not be applied before they download it. Only the request that
 * actually delivers a file writes to `exports`, or every dialog double-counts.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const associate = await getCurrentAssociate();
  if (!associate) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  const { id } = await params;
  const preflight = new URL(request.url).searchParams.get("preflight") === "1";
  const admin = createAdminClient();

  const { data: analysis } = await admin
    .from("analyses")
    .select("id, associate_id, filename, storage_path, original_storage_path, source_format, intake_route, status")
    .eq("id", id)
    .maybeSingle();

  if (!analysis) {
    return NextResponse.json({ error: "Analysis not found." }, { status: 404 });
  }
  if (analysis.associate_id !== associate.id && !associate.is_admin) {
    return NextResponse.json({ error: "Not authorized to export this analysis." }, { status: 403 });
  }
  if (analysis.status !== "complete") {
    return NextResponse.json({ error: "Analysis isn't complete yet." }, { status: 400 });
  }
  if (analysis.source_format !== "docx" || !analysis.original_storage_path) {
    return NextResponse.json(
      { error: "Tracked-changes export is only available for contracts uploaded as DOCX." },
      { status: 400 }
    );
  }

  // §1.4.9 decided at upload that this document could not be safely edited, and
  // the associate was told so before they reviewed anything. Honour that here
  // rather than editing it anyway and leaning on §1.6 to catch the damage.
  if (analysis.intake_route === "pdf") {
    return NextResponse.json(
      {
        error:
          "This document could not be read cleanly enough to edit, so it takes the PDF path. " +
          "Use the marked-up PDF export instead.",
        markupPdfUrl: `/api/analyses/${id}/export-markup`,
      },
      { status: 400 }
    );
  }

  const { data: originalBlob, error: downloadError } = await admin.storage
    .from(STORAGE_BUCKET)
    .download(analysis.original_storage_path);
  if (downloadError || !originalBlob) {
    return NextResponse.json(
      { error: `Could not load the original document: ${downloadError?.message}` },
      { status: 500 }
    );
  }

  const findings = await getActionedFindings(admin, id);
  const originalBytes = new Uint8Array(await originalBlob.arrayBuffer());

  let engineResult;
  try {
    engineResult = await generateRedline({
      originalDocxBytes: originalBytes,
      findings,
      author: associate.name,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not generate tracked changes.";
    return NextResponse.json({ error: message }, { status: 500 });
  }

  const report = await validateRedline({ originalBytes, engineResult, author: associate.name });

  const unapplied = report.unapplied.map((u) => ({ ...u, explanation: UNAPPLIED_REASON_TEXT[u.reason] }));
  const markupPdfUrl = `/api/analyses/${id}/export-markup`;

  if (preflight) {
    return NextResponse.json({
      outcome: report.outcome,
      appliedCount: report.appliedCount,
      unapplied,
      fallbackReason: report.fallbackReason,
      markupPdfUrl,
    });
  }

  await recordResolutions(admin, engineResult.resolutions);

  await recordExport(admin, {
    analysisId: id,
    associateId: associate.id,
    format: "docx",
    outcome: report.outcome,
    fallbackReason: report.fallbackReason,
    findingsApplied: report.appliedCount,
    findingsUnapplied: report.unapplied.length,
    unappliedDetail: report.unapplied.length ? report.unapplied : null,
    analysisPaths: analysis,
  });

  await logAudit({
    actorId: associate.id,
    action: "redline_docx_exported",
    entityType: "analysis",
    entityId: id,
    metadata: {
      outcome: report.outcome,
      matched: report.appliedCount,
      unmatched: report.unapplied.length,
      fallback_reason: report.fallbackReason,
    },
  });

  // §1.6.4 — discard the output entirely rather than hand over a file that
  // might not open. The marked-up PDF carries the same findings.
  if (report.outcome === "fallback") {
    return NextResponse.json(
      {
        error: "The marked-up Word file did not pass validation, so it was discarded.",
        outcome: report.outcome,
        fallbackReason: report.fallbackReason,
        markupPdfUrl,
      },
      { status: 409 }
    );
  }

  const outFilename = analysis.filename.replace(/\.docx$/i, "") + "-redline.docx";
  return new NextResponse(Buffer.from(engineResult.docxBytes), {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "Content-Disposition": `attachment; filename="${outFilename}"`,
      "X-Export-Outcome": report.outcome,
    },
  });
}
