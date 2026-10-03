import type { createAdminClient } from "../supabase/admin";
import { noteProblem } from "./note-guard";

/**
 * The allowlist for redline comments (CLAUDE.md deviation 8). Modelled on
 * §1.8.3's property-email allowlist, and for the same reason: the redline
 * reaches the property, so what can reach it is decided by a filter, not a
 * prompt.
 *
 * The only text that can become a comment is the finding's note, as the model
 * wrote it or the associate edited it. Excluded, and never fetched here:
 * finding_text, cd_standard, compromise_range, severity, exposure, headline.
 *
 * Legal findings never reach the redline, so they have no comment either.
 */

/** Mirrors the narrowed SELECT below. Keep the two in step. */
export interface RedlineCommentRow {
  id: string;
  /** Read only to drop legal findings. */
  category?: string | null;
  redline_note: string | null;
  /** The associate's version. Null means use the model's; empty means no comment. */
  edited_redline_note: string | null;
}

export const REDLINE_COMMENT_COLUMNS = "id, category, redline_note, edited_redline_note";

/**
 * Pure, so the allowlist is a unit test rather than a comment. Fields are read
 * one by one; never spread a row here.
 *
 * The content check runs again as the last step, so a note that was stored
 * before a rule existed, or written straight to the database, still can't
 * reach the file.
 */
export function assembleRedlineComments(rows: RedlineCommentRow[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const row of rows) {
    if (row.category === "legal") continue;
    const note = (row.edited_redline_note ?? row.redline_note ?? "").trim();
    if (!note || noteProblem(note)) continue;
    out.set(row.id, note);
  }
  return out;
}

/**
 * The SELECT is the outermost layer. Excluded columns are never fetched, so
 * they cannot leak even if the type above is widened later.
 *
 * Before migration 014 the columns don't exist, the query fails, and the
 * redline goes out without comments.
 */
export async function getRedlineComments(
  admin: ReturnType<typeof createAdminClient>,
  analysisId: string
): Promise<Map<string, string>> {
  const { data } = await admin
    .from("findings")
    .select(REDLINE_COMMENT_COLUMNS)
    .eq("analysis_id", analysisId)
    .neq("category", "legal");
  return assembleRedlineComments((data ?? []) as RedlineCommentRow[]);
}
