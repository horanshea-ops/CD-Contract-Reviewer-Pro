import type { createAdminClient } from "../supabase/admin";
import { clauseLabel } from "../format";
import { assertsNoChange } from "../proposed-language";

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
 * and fallback position), compromise_range (how far CD will move). All of it
 * is leverage.
 *
 * Legal findings never reach the property at all. CD gives no legal advice,
 * so they carry no wording, and they are points for the client's own counsel.
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
  /** Read only to drop legal findings. It never reaches the payload. Absent only before migration 013. */
  category?: string | null;
  is_missing_clause: boolean;
  proposed_language: string;
}

export interface PropertyActionRow {
  finding_id: string;
  action: string;
  edited_language: string | null;
  created_at: string;
  /** True when the associate sends the change in the email itself. Absent before migration 018. */
  by_email?: boolean | null;
  /** The contract wording the associate picked for the change. Absent before migration 018. */
  edited_quote?: string | null;
}

/**
 * A change the associate chose to send in the email itself, because the
 * redline has no place for it. The email lists these after the model's draft.
 *
 * The model is never given this. Its payload stays the three fields above, with
 * no contract wording, so it has nothing to frame as before and after. The
 * list is written by `emailedChangesText` below, in fixed words.
 *
 * `contract_wording` is the contract's own text, which the property already
 * has. It is the wording the associate picked, or the review's quote.
 */
export interface PropertyEmailedChange {
  clause_type: string;
  contract_wording: string | null;
  proposed_language: string;
}

/** Mirrors the SELECT in getPropertyEmailedChanges, which adds the contract's own wording. */
export interface PropertyEmailedFindingRow extends PropertyFindingRow {
  quoted_text: string | null;
}

/** The latest decision on each finding. */
function latestByFinding(actionRows: PropertyActionRow[]): Map<string, PropertyActionRow> {
  const latest = new Map<string, PropertyActionRow>();
  for (const row of [...actionRows].sort((a, b) => (a.created_at < b.created_at ? 1 : -1))) {
    if (!latest.has(row.finding_id)) latest.set(row.finding_id, row);
  }
  return latest;
}

const isAccepted = (action: PropertyActionRow | undefined): action is PropertyActionRow =>
  action != null && (action.action === "accept" || action.action === "edit");

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
  const latestActionByFinding = latestByFinding(actionRows);

  return findingRows
    .filter((f) => f.category !== "legal")
    .map((f) => ({ f, action: latestActionByFinding.get(f.id) }))
    .filter((x): x is { f: PropertyFindingRow; action: PropertyActionRow } => isAccepted(x.action))
    // A change sent in the email itself is listed by code, below the draft, and is not described by the model.
    .filter(({ action }) => !action.by_email)
    .map(({ f, action }) => ({
      clause_type: f.clause_type,
      is_missing_clause: f.is_missing_clause,
      proposed_language:
        action.action === "edit" && action.edited_language ? action.edited_language : f.proposed_language,
    }))
    // A finding proposing no change, or raised without wording, is not an item the property was sent.
    .filter((item) => item.proposed_language.trim() && !assertsNoChange(item.proposed_language));
}

/**
 * The changes the associate sends in the email itself. Fields are listed one
 * by one, as above, and a legal finding never qualifies.
 */
export function assembleEmailedChanges(
  findingRows: PropertyEmailedFindingRow[],
  actionRows: PropertyActionRow[]
): PropertyEmailedChange[] {
  const latestActionByFinding = latestByFinding(actionRows);

  return findingRows
    .filter((f) => f.category !== "legal")
    .map((f) => ({ f, action: latestActionByFinding.get(f.id) }))
    .filter((x): x is { f: PropertyEmailedFindingRow; action: PropertyActionRow } => isAccepted(x.action))
    .filter(({ action }) => !!action.by_email)
    .map(({ f, action }) => ({
      clause_type: f.clause_type,
      contract_wording: f.is_missing_clause ? null : ((action.edited_quote ?? f.quoted_text)?.trim() || null),
      proposed_language:
        action.action === "edit" && action.edited_language ? action.edited_language : f.proposed_language,
    }))
    .filter((item) => item.proposed_language.trim() && !assertsNoChange(item.proposed_language));
}

/**
 * The list the email carries for those changes, or an empty string when there
 * are none. Fixed words around the clause's name, the contract's wording and
 * the proposed wording, and nothing else.
 */
export function emailedChangesText(changes: PropertyEmailedChange[]): string {
  if (changes.length === 0) return "";
  const entries = changes.map((c, i) =>
    [
      `${i + 1}. ${clauseLabel(c.clause_type)}`,
      c.contract_wording ? `Current wording: "${c.contract_wording}"` : "This is a new provision.",
      `Proposed wording: "${c.proposed_language.trim()}"`,
    ].join("\n")
  );
  const lead =
    changes.length === 1
      ? "One further change is not shown in the attached contract:"
      : "These further changes are not shown in the attached contract:";
  return [lead, ...entries].join("\n\n");
}

/** The model's draft with the list of emailed changes after it. */
export function withEmailedChanges(body: string, changes: PropertyEmailedChange[]): string {
  const list = emailedChangesText(changes);
  return list ? `${body.trimEnd()}\n\n${list}` : body;
}

const ACTION_COLUMNS = "finding_id, action, edited_language, created_at";

/** The decisions on these findings. A database without migration 018 has no placement columns, and still answers. */
async function propertyActions(admin: ReturnType<typeof createAdminClient>, findingIds: string[]): Promise<PropertyActionRow[]> {
  if (findingIds.length === 0) return [];
  const read = (columns: string) => admin.from("finding_actions").select(columns).in("finding_id", findingIds);

  let { data, error } = await read(`${ACTION_COLUMNS}, by_email, edited_quote`);
  if (error) ({ data, error } = await read(ACTION_COLUMNS));
  return (data ?? []) as unknown as PropertyActionRow[];
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
    .select("id, clause_type, category, is_missing_clause, proposed_language")
    .eq("analysis_id", analysisId)
    .neq("category", "legal");

  const actionRows = await propertyActions(
    admin,
    (findingRows ?? []).map((f) => f.id)
  );
  return assemblePropertyEmailItems(findingRows ?? [], actionRows);
}

/**
 * The changes sent in the email itself, with the contract's own wording. This
 * SELECT adds `quoted_text` to the one above and nothing more.
 */
export async function getPropertyEmailedChanges(
  admin: ReturnType<typeof createAdminClient>,
  analysisId: string
): Promise<PropertyEmailedChange[]> {
  const { data: findingRows } = await admin
    .from("findings")
    .select("id, clause_type, category, is_missing_clause, quoted_text, proposed_language")
    .eq("analysis_id", analysisId)
    .neq("category", "legal");

  const actionRows = await propertyActions(
    admin,
    (findingRows ?? []).map((f) => f.id)
  );
  return assembleEmailedChanges(findingRows ?? [], actionRows);
}
