import { NextResponse } from "next/server";
import { getCurrentAssociate } from "@/lib/current-associate";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";
import { getActionedFindings } from "@/lib/get-actioned-findings";
import { getPositionedLines } from "@/lib/get-positioned-lines";
import { generateCleanContractPdf, type CleanContractFinding } from "@/lib/clean-contract-pdf";
import { recordExport } from "@/lib/export-log";

const STORAGE_BUCKET = "contracts";

/**
 * §1.7.7 — the contract as it would read if the property agreed to every
 * accepted change. The marked-up PDF shows what changed; this shows the result.
 *
 * `?preflight=1` returns the verdict as JSON without the file, so the associate
 * sees what could not be placed, and any refusal, before downloading.
 *
 * A document that fails its content check is refused rather than streamed. It
 * would look like a finished contract while missing text, which is the failure
 * §1.6.4 and §1.4.9 both guard against in their own paths.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const associate = await getCurrentAssociate();
  if (!associate) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  const preflight = new URL(request.url).searchParams.get("preflight") === "1";
  const { id } = await params;
  const admin = createAdminClient();

  const { data: analysis } = await admin
    .from("analyses")
    .select("id, associate_id, status, source_format, storage_path, original_storage_path, thread_id")
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

  const { data: pdfBlob, error: pdfError } = await admin.storage
    .from(STORAGE_BUCKET)
    .download(analysis.storage_path);
  if (pdfError || !pdfBlob) {
    return NextResponse.json({ error: `Could not load the document: ${pdfError?.message}` }, { status: 500 });
  }

  let lines;
  try {
    lines = await getPositionedLines({
      admin,
      associateId: analysis.associate_id,
      analysisId: id,
      sourceFormat: analysis.source_format,
      pdfBytes: new Uint8Array(await pdfBlob.arrayBuffer()),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not read this document's text.";
    return NextResponse.json({ error: message }, { status: 500 });
  }

  // The allowlist boundary. getActionedFindings carries severity, finding_text
  // and cd_standard; this document can reach the property, so only contract
  // text crosses into it. Same rule as §1.8.3's property email.
  const findings: CleanContractFinding[] = (await getActionedFindings(admin, id)).map((f) => ({
    clause_type: f.clause_type,
    location_section: f.location_section,
    quoted_text: f.quoted_text,
    language: f.language,
    is_missing_clause: f.is_missing_clause,
  }));

  if (findings.length === 0) {
    return NextResponse.json(
      { error: "No accepted changes, so this would just be the original contract." },
      { status: 400 }
    );
  }

  // The property's own name where the analysis is linked to a thread, never the
  // filename — a CD filename can carry internal shorthand about the deal.
  let title = "Proposed Amended Contract";
  if (analysis.thread_id) {
    const { data: thread } = await admin
      .from("negotiation_threads")
      .select("property_name")
      .eq("id", analysis.thread_id)
      .maybeSingle();
    if (thread?.property_name) title = `Proposed Amended Contract — ${thread.property_name}`;
  }

  let result;
  try {
    result = await generateCleanContractPdf({ lines, findings, title });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not build the contract.";
    return NextResponse.json({ error: message }, { status: 500 });
  }

  const outcome = !result.conservation.ok ? "fallback" : result.unplaced.length ? "partial" : "clean";

  if (preflight) {
    return NextResponse.json({
      outcome,
      appliedCount: result.appliedCount,
      additions: result.additions.map((a) => ({ clause_type: a.clause_type })),
      unplaced: result.unplaced.map((u) => ({ clause_type: u.clause_type, reason: u.reason })),
      problems: result.conservation.problems,
      markupPdfUrl: `/api/analyses/${id}/export-markup`,
    });
  }

  if (!result.conservation.ok) {
    return NextResponse.json(
      {
        error: "The clean contract failed its content check and was not produced.",
        problems: result.conservation.problems,
      },
      { status: 409 }
    );
  }

  await recordExport(admin, {
    analysisId: id,
    associateId: associate.id,
    format: "pdf",
    outcome,
    findingsApplied: result.appliedCount,
    findingsUnapplied: result.unplaced.length,
    unappliedDetail: result.unplaced.length ? result.unplaced : null,
    analysisPaths: analysis,
  });

  await logAudit({
    actorId: associate.id,
    action: "clean_contract_exported",
    entityType: "analysis",
    entityId: id,
    metadata: {
      applied: result.appliedCount,
      additions: result.additions.length,
      unplaced: result.unplaced.length,
      outcome,
      source_format: analysis.source_format,
    },
  });

  return new NextResponse(Buffer.from(result.pdfBytes), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="proposed-contract-${id.slice(0, 8)}.pdf"`,
    },
  });
}
