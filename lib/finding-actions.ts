import type { createAdminClient } from "./supabase/admin";

/**
 * The associate's latest decision on each finding.
 *
 * A decision can also say where a change belongs: the wording the associate
 * picked for it, the wording just before that, or that the change goes in the
 * email to the property and not in the redline.
 */

export interface LatestAction {
  finding_id: string;
  action: string;
  edited_language: string | null;
  dismissal_reason: string | null;
  created_at: string;
  /** The contract wording the associate picked for the change, in place of the model's quote. */
  edited_quote: string | null;
  /** The wording just before it, which says which of several places is meant. */
  quote_context: string | null;
  /** True when the change goes to the property by email, by the associate's choice. */
  by_email: boolean;
}

const COLUMNS = "finding_id, action, edited_language, dismissal_reason, created_at";
const PLACEMENT_COLUMNS = "edited_quote, quote_context, by_email";

export async function latestActions(
  admin: ReturnType<typeof createAdminClient>,
  findingIds: string[]
): Promise<Map<string, LatestAction>> {
  const latest = new Map<string, LatestAction>();
  if (findingIds.length === 0) return latest;

  const read = (columns: string) =>
    admin.from("finding_actions").select(columns).in("finding_id", findingIds).order("created_at", { ascending: false });

  // A database without migration 018 has no placement columns, and its decisions still have to load.
  let { data, error } = await read(`${COLUMNS}, ${PLACEMENT_COLUMNS}`);
  if (error) ({ data, error } = await read(COLUMNS));

  for (const row of (data ?? []) as unknown as Partial<LatestAction>[]) {
    if (!row.finding_id || latest.has(row.finding_id)) continue;
    latest.set(row.finding_id, {
      finding_id: row.finding_id,
      action: row.action ?? "",
      edited_language: row.edited_language ?? null,
      dismissal_reason: row.dismissal_reason ?? null,
      created_at: row.created_at ?? "",
      edited_quote: row.edited_quote ?? null,
      quote_context: row.quote_context ?? null,
      by_email: row.by_email ?? false,
    });
  }
  return latest;
}
