import type { createAdminClient } from "../supabase/admin";
import { assertsNoChange } from "../proposed-language";

/**
 * §1.8.1 — input assembly for a client email: accepted/edited findings
 * only, in plain business terms. A separate function from
 * lib/get-actioned-findings.ts on purpose — that one's return type
 * (RevisionFinding) is shared by three already-shipped export paths
 * (redline, PDF markup, memo) and doesn't carry exposure_amount/
 * exposure_basis, which §1.8.2 needs ("quantified exposure figures with
 * their basis"). Widening a type three other features depend on for one
 * new consumer is a bigger blast radius than a little duplication here.
 */
export interface EmailFinding {
  clause_type: string;
  severity: "high" | "medium" | "low" | "note";
  is_missing_clause: boolean;
  quoted_text: string | null;
  language: string;
  finding_text: string;
  exposure_amount: number | null;
  exposure_basis: string | null;
}

export interface FindingRow {
  id: string;
  clause_type: string;
  severity: "high" | "medium" | "low" | "note";
  is_missing_clause: boolean;
  quoted_text: string | null;
  finding_text: string;
  proposed_language: string;
  exposure_amount: number | null;
  exposure_basis: string | null;
}

export interface ActionRow {
  finding_id: string;
  action: string;
  edited_language: string | null;
  created_at: string;
}

/**
 * Pure — no DB access, so "dismissed findings never reach the email" is a
 * plain unit test rather than a comment (the plan's own instruction).
 * Accept/edit only; edited language wins over the model's proposed
 * language where the associate changed it; latest action per finding wins
 * when there's more than one (a re-decision).
 */
export function assembleEmailFindings(findingRows: FindingRow[], actionRows: ActionRow[]): EmailFinding[] {
  const latestActionByFinding = new Map<string, ActionRow>();
  for (const row of [...actionRows].sort((a, b) => (a.created_at < b.created_at ? 1 : -1))) {
    if (!latestActionByFinding.has(row.finding_id)) {
      latestActionByFinding.set(row.finding_id, row);
    }
  }

  return findingRows
    .map((f) => ({ f, action: latestActionByFinding.get(f.id) }))
    .filter(
      (x): x is { f: FindingRow; action: ActionRow } =>
        x.action != null && (x.action.action === "accept" || x.action.action === "edit")
    )
    .map(({ f, action }) => ({
      clause_type: f.clause_type,
      severity: f.severity,
      is_missing_clause: f.is_missing_clause,
      quoted_text: f.quoted_text,
      language: action.action === "edit" && action.edited_language ? action.edited_language : f.proposed_language,
      finding_text: f.finding_text,
      exposure_amount: f.exposure_amount,
      exposure_basis: f.exposure_basis,
    }))
    // A finding proposing no change is not a change to tell the client about.
    // Shared with every export path — see lib/proposed-language.ts.
    .filter((f) => !assertsNoChange(f.language));
}

export async function getEmailFindings(
  admin: ReturnType<typeof createAdminClient>,
  analysisId: string
): Promise<EmailFinding[]> {
  const { data: findingRows } = await admin
    .from("findings")
    .select(
      "id, clause_type, severity, is_missing_clause, quoted_text, finding_text, proposed_language, exposure_amount, exposure_basis"
    )
    .eq("analysis_id", analysisId);

  const findingIds = (findingRows ?? []).map((f) => f.id);
  const { data: actionRows } = findingIds.length
    ? await admin
        .from("finding_actions")
        .select("finding_id, action, edited_language, created_at")
        .in("finding_id", findingIds)
    : { data: [] };

  return assembleEmailFindings(findingRows ?? [], actionRows ?? []);
}
