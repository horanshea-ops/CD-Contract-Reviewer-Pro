import type { createAdminClient } from "./supabase/admin";
import type { RevisionFinding } from "./redline-engine/types";

const SEVERITY_ORDER: Record<string, number> = { high: 0, medium: 1, low: 2, note: 3 };

/**
 * Fetches every accepted/edited finding for an analysis, in the shape the
 * export formats need. The associate's edited language where they edited,
 * otherwise the model's proposed language; dismissed and undecided findings
 * excluded; sorted by severity. Shared because every export route needs
 * exactly this.
 *
 * It carries the finding's id and section reference too. §1.5 needs the section
 * to tell two copies of the same wording apart, and the id to write back how
 * each one resolved; the memo and PDF exports ignore both.
 */
export async function getActionedFindings(
  admin: ReturnType<typeof createAdminClient>,
  analysisId: string
): Promise<RevisionFinding[]> {
  const { data: findingRowsRaw } = await admin
    .from("findings")
    .select("id, clause_type, severity, is_missing_clause, quoted_text, location_section, finding_text, cd_standard, proposed_language")
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
      id: f.id,
      location_section: f.location_section,
      clause_type: f.clause_type,
      severity: f.severity,
      is_missing_clause: f.is_missing_clause,
      quoted_text: f.quoted_text,
      language: action.action === "edit" && action.edited_language ? action.edited_language : f.proposed_language,
      finding_text: f.finding_text,
      cd_standard: f.cd_standard,
    }));
}
