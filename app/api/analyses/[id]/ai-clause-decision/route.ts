import { NextResponse } from "next/server";
import { after } from "next/server";
import { getCurrentAssociate } from "@/lib/current-associate";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";
import { processAnalysis } from "@/lib/analysis-pipeline";

/**
 * Records an associate's §1.10.3 decision on a document the AI-use pre-check
 * blocked before any network call, and either resumes or stops the analysis.
 *
 * This is the §1.10.4 compliance artifact: a human saw the matched language
 * and made a call. "Proceed" re-invokes processAnalysis, which re-extracts
 * and re-scans (cheap, local, deterministic) but skips the block this time
 * since ai_clause_acknowledged_at is now set, then makes the model call it
 * withheld before. "Abort" ends the analysis without ever calling the model.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const associate = await getCurrentAssociate();
  if (!associate) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  const { id } = await params;
  const body = await request.json().catch(() => null);
  const decision = body?.decision;
  if (decision !== "proceed" && decision !== "abort") {
    return NextResponse.json({ error: "decision must be \"proceed\" or \"abort\"." }, { status: 400 });
  }

  const admin = createAdminClient();

  const { data: analysis } = await admin
    .from("analyses")
    .select("id, associate_id, status, ai_clause_scan_result, ai_clause_acknowledged_at")
    .eq("id", id)
    .maybeSingle();

  if (!analysis) {
    return NextResponse.json({ error: "Analysis not found." }, { status: 404 });
  }
  if (analysis.associate_id !== associate.id && !associate.is_admin) {
    return NextResponse.json({ error: "Not authorized to decide on this analysis." }, { status: 403 });
  }

  const scanResult = analysis.ai_clause_scan_result as { matches?: unknown[] } | null;
  if (!scanResult?.matches?.length) {
    return NextResponse.json({ error: "This analysis has no pending AI-use decision." }, { status: 400 });
  }
  if (analysis.ai_clause_acknowledged_at) {
    return NextResponse.json({ error: "This decision has already been recorded." }, { status: 409 });
  }

  const { error: updateError } = await admin
    .from("analyses")
    .update({
      ai_clause_acknowledged_by: associate.id,
      ai_clause_acknowledged_at: new Date().toISOString(),
      ai_clause_scan_result: { ...scanResult, decision },
    })
    .eq("id", id);
  if (updateError) {
    return NextResponse.json({ error: `Could not record the decision: ${updateError.message}` }, { status: 500 });
  }

  await logAudit({
    actorId: associate.id,
    action: "ai_clause_scan_acknowledged",
    entityType: "analysis",
    entityId: id,
    metadata: { decision, matched_terms: (scanResult.matches as { term: string }[]).map((m) => m.term) },
  });

  if (decision === "abort") {
    const abortMessage =
      "Analysis stopped at the AI-use pre-check — an associate reviewed the matched language and chose not to proceed.";
    await admin
      .from("analyses")
      .update({ status: "failed", completed_at: new Date().toISOString(), error: abortMessage })
      .eq("id", id);
    return NextResponse.json({ outcome: "aborted", error: abortMessage });
  }

  after(() => processAnalysis(id));
  return NextResponse.json({ outcome: "resumed" });
}
