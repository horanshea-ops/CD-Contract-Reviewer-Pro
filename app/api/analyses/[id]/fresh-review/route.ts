import { NextResponse } from "next/server";
import { after } from "next/server";
import { getCurrentAssociate } from "@/lib/current-associate";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";
import { processAnalysis } from "@/lib/analysis-pipeline";
import { limitReachedMessage, reviewAllowance } from "@/lib/review-allowance";

// Read by serverless hosts only. It covers MODEL_CALL_BUDGET_MS plus the
// upload and saves. Render runs a long-lived server and ignores it.
export const maxDuration = 600;

/**
 * Runs a new review on an analysis whose findings were copied from an earlier
 * review of the same file.
 *
 * This is a paid review, so it is checked against the monthly allowance as an
 * upload is. The copied findings and the decisions on them are cleared first.
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
    .select("id, associate_id, status, review_kind, copied_from_analysis_id")
    .eq("id", id)
    .maybeSingle();

  if (!analysis) {
    return NextResponse.json({ error: "Analysis not found." }, { status: 404 });
  }
  if (analysis.associate_id !== associate.id && !associate.is_admin) {
    return NextResponse.json({ error: "Not authorized to review this analysis again." }, { status: 403 });
  }
  if (analysis.status !== "complete" || analysis.review_kind !== "copied") {
    return NextResponse.json({ error: "Only a copied review can be run again this way." }, { status: 409 });
  }

  const allowance = await reviewAllowance(admin, analysis.associate_id);
  if (allowance.remaining === 0) {
    return NextResponse.json({ error: limitReachedMessage(allowance) }, { status: 403 });
  }

  const { error: clearError } = await admin.from("findings").delete().eq("analysis_id", id);
  if (clearError) {
    return NextResponse.json({ error: `Could not clear the copied findings: ${clearError.message}` }, { status: 500 });
  }
  await admin.from("contract_terms").delete().eq("analysis_id", id);

  const { error: resetError } = await admin
    .from("analyses")
    .update({
      status: "queued",
      error: null,
      started_at: null,
      completed_at: null,
      review_kind: "full",
      copied_from_analysis_id: null,
    })
    .eq("id", id);
  if (resetError) {
    return NextResponse.json({ error: `Could not restart the analysis: ${resetError.message}` }, { status: 500 });
  }

  await logAudit({
    actorId: associate.id,
    action: "analysis_fresh_review",
    entityType: "analysis",
    entityId: id,
    metadata: { copied_from: analysis.copied_from_analysis_id },
  });

  after(() => processAnalysis(id, { fresh: true }));

  return NextResponse.json({ status: "queued" }, { status: 202 });
}
