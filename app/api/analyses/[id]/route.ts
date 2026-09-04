import { NextResponse } from "next/server";
import { getCurrentAssociate } from "@/lib/current-associate";
import { createAdminClient } from "@/lib/supabase/admin";

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
    .select("id, associate_id, client_id, filename, storage_path, status, error, created_at, completed_at, model_id, library_version")
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

    findings = (findingRows ?? []).map((f) => ({
      ...f,
      current_action: latestActionByFinding.get(f.id) ?? null,
    }));
  }

  let documentUrl: string | null = null;
  const { data: signed } = await admin.storage
    .from(STORAGE_BUCKET)
    .createSignedUrl(analysis.storage_path, SIGNED_URL_TTL_SECONDS);
  documentUrl = signed?.signedUrl ?? null;

  return NextResponse.json({ ...analysis, findings, documentUrl });
}
