import type { createAdminClient } from "./supabase/admin";
import type { MemoFinding } from "./export-memo";

const SEVERITY_ORDER: Record<string, number> = { high: 0, medium: 1, low: 2, note: 3 };

/**
 * Fetches every accepted/edited finding for an analysis, in the shape both
 * export formats need (requested-revisions memo, marked-up PDF): the
 * associate's edited language where they edited, otherwise the model's
 * proposed language; dismissed and undecided findings excluded; sorted by
 * severity. Shared because both export routes need exactly this.
 */
export async function getActionedFindings(
  admin: ReturnType<typeof createAdminClient>,
  analysisId: string
): Promise<MemoFinding[]> {
  const { data: findingRowsRaw } = await admin
    .from("findings")
    .select("id, clause_type, severity, is_missing_clause, quoted_text, finding_text, cd_standard, proposed_language")
    .eq("analysis_id", analysisId);
  const findingRows = findingRowsRaw ?? [];
  type FindingRow = (typeof findingRows)[number];

  const findingIds = findingRows.map((f) => f.id);
  const { data: actionRows } = findingIds.length
    ? await admin
        .from("finding_actions")
        .select("finding_id, action, edited_language, created_at")
        .in("finding_id", findingIds)
        .order("created_at", { ascending: false })
    : { data: [] };

  const latestActionByFinding = new Map<string, { action: string; edited_language: string | null }>();
  for (const row of actionRows ?? []) {
    if (!latestActionByFinding.has(row.finding_id)) {
      latestActionByFinding.set(row.finding_id, { action: row.action, edited_language: row.edited_language });
    }
  }

  return findingRows
    .map((f) => ({ f, action: latestActionByFinding.get(f.id) }))
    .filter((x): x is { f: FindingRow; action: { action: string; edited_language: string | null } } =>
      x.action != null && (x.action.action === "accept" || x.action.action === "edit")
    )
    .sort((a, b) => SEVERITY_ORDER[a.f.severity] - SEVERITY_ORDER[b.f.severity])
    .map(({ f, action }) => ({
      clause_type: f.clause_type,
      severity: f.severity,
      is_missing_clause: f.is_missing_clause,
      quoted_text: f.quoted_text,
      language: action.action === "edit" && action.edited_language ? action.edited_language : f.proposed_language,
      finding_text: f.finding_text,
      cd_standard: f.cd_standard,
    }));
}
