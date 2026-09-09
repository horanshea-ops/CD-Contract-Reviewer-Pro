import type { createAdminClient } from "../supabase/admin";

/**
 * §1.8.3 — input assembly for a property-facing email. The plan's own
 * instruction: "Implement as a hard field allowlist on the payload, not a
 * prompt instruction. A prompt can be talked out of it; a filter cannot."
 *
 * So this file deliberately duplicates lib/email-drafting/input-assembly.ts
 * rather than sharing with it. Anyone auditing "can CD's negotiating position
 * reach the counterparty?" reads this one file and sees every field that can.
 * Sharing a base type with the client path would put the answer in two places
 * and make widening it a one-line change.
 *
 * Excluded, and unreachable from here: severity, exposure_amount,
 * exposure_basis, finding_text (why CD flagged it), cd_standard (CD's internal
 * and fallback position). All of it is leverage.
 */

/**
 * Every field that may reach the property. `proposed_language` is contract
 * text the property already reads in the redline, so it is not a disclosure.
 *
 * Named `proposed_language` rather than `language` on purpose — EmailFinding
 * (the client shape) uses `language`, so passing client findings in here is a
 * compile error rather than a silent leak.
 */
export interface PropertyEmailItem {
  clause_type: string;
  is_missing_clause: boolean;
  proposed_language: string;
}

/** Mirrors the narrowed SELECT in getPropertyEmailItems. */
export interface PropertyFindingRow {
  id: string;
  clause_type: string;
  is_missing_clause: boolean;
  proposed_language: string;
}

export interface PropertyActionRow {
  finding_id: string;
  action: string;
  edited_language: string | null;
  created_at: string;
}

/**
 * Pure, so "nothing sensitive survives assembly" is a unit test rather than a
 * comment. Accept/edit only; the associate's edited language wins where they
 * changed it; the latest action wins when a finding was re-decided.
 *
 * Fields are listed one by one below. Never spread the row — a spread would
 * carry whatever extra columns a future SELECT happens to fetch.
 */
export function assemblePropertyEmailItems(
  findingRows: PropertyFindingRow[],
  actionRows: PropertyActionRow[]
): PropertyEmailItem[] {
  const latestActionByFinding = new Map<string, PropertyActionRow>();
  for (const row of [...actionRows].sort((a, b) => (a.created_at < b.created_at ? 1 : -1))) {
    if (!latestActionByFinding.has(row.finding_id)) {
      latestActionByFinding.set(row.finding_id, row);
    }
  }

  return findingRows
    .map((f) => ({ f, action: latestActionByFinding.get(f.id) }))
    .filter(
      (x): x is { f: PropertyFindingRow; action: PropertyActionRow } =>
        x.action != null && (x.action.action === "accept" || x.action.action === "edit")
    )
    .map(({ f, action }) => ({
      clause_type: f.clause_type,
      is_missing_clause: f.is_missing_clause,
      proposed_language:
        action.action === "edit" && action.edited_language ? action.edited_language : f.proposed_language,
    }));
}

/**
 * The SELECT is the outermost layer of the allowlist. The excluded columns are
 * never fetched, so they cannot leak even if the types above are later widened.
 * Keep this column list and PropertyFindingRow in step.
 */
export async function getPropertyEmailItems(
  admin: ReturnType<typeof createAdminClient>,
  analysisId: string
): Promise<PropertyEmailItem[]> {
  const { data: findingRows } = await admin
    .from("findings")
    .select("id, clause_type, is_missing_clause, proposed_language")
    .eq("analysis_id", analysisId);

  const findingIds = (findingRows ?? []).map((f) => f.id);
  const { data: actionRows } = findingIds.length
    ? await admin
        .from("finding_actions")
        .select("finding_id, action, edited_language, created_at")
        .in("finding_id", findingIds)
    : { data: [] };

  return assemblePropertyEmailItems(findingRows ?? [], actionRows ?? []);
}
