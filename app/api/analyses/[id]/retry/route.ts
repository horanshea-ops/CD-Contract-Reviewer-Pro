import { NextResponse } from "next/server";
import { after } from "next/server";
import { getCurrentAssociate } from "@/lib/current-associate";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";
import { processAnalysis } from "@/lib/analysis-pipeline";
import { retryability } from "@/lib/analysis-status";

export const maxDuration = 300;

/**
 * Re-runs an analysis that failed or stalled, on the file already in storage.
 *
 * The alternative was making the associate upload the contract again, which
 * loses the thread linkage and the round number and reads as the tool blaming
 * them for its own dropped connection.
 *
 * Findings from the abandoned attempt are cleared first, so a retry never
 * leaves two passes' findings side by side. `finding_actions` goes with them
 * by cascade.
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
    .select("id, associate_id, status, created_at, started_at, ai_clause_scan_result, ai_clause_acknowledged_at")
    .eq("id", id)
    .maybeSingle();

  if (!analysis) {
    return NextResponse.json({ error: "Analysis not found." }, { status: 404 });
  }
  if (analysis.associate_id !== associate.id && !associate.is_admin) {
    return NextResponse.json({ error: "Not authorized to retry this analysis." }, { status: 403 });
  }

  const verdict = retryability(analysis);
  if (!verdict.allowed) {
    return NextResponse.json({ error: verdict.reason }, { status: 409 });
  }

  const { error: clearError } = await admin.from("findings").delete().eq("analysis_id", id);
  if (clearError) {
    return NextResponse.json(
      { error: `Could not clear the previous attempt: ${clearError.message}` },
      { status: 500 }
    );
  }

  const { error: resetError } = await admin
    .from("analyses")
    .update({ status: "queued", error: null, started_at: null, completed_at: null })
    .eq("id", id);
  if (resetError) {
    return NextResponse.json({ error: `Could not restart the analysis: ${resetError.message}` }, { status: 500 });
  }

  await logAudit({
    actorId: associate.id,
    action: "analysis_retried",
    entityType: "analysis",
    entityId: id,
    metadata: { previous_status: analysis.status },
  });

  after(() => processAnalysis(id));

  return NextResponse.json({ status: "queued" }, { status: 202 });
}
