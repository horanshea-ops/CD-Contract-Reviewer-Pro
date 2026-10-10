import type { createAdminClient } from "../supabase/admin";
import { findingCategory } from "../findings-overview";
import { assertsNoChange } from "../proposed-language";
import { generateRedline, type RevisionFinding } from "../redline-engine";
import type { Category } from "../standards/types";
import { validateRedline, type UnappliedReason } from "../redline-validation";
import { cachedBuild, fingerprint } from "./build-cache";

/**
 * The export's own check, run before anyone exports.
 *
 * A review card works from the review's text and never opens the Word file, so
 * the export used to be the first thing to learn that a change had no place in
 * it. This runs the same engine and the same oracle when the review screen
 * loads, over every change that isn't dismissed, so each card can say what will
 * happen to its change while the associate is still deciding.
 *
 * It writes nothing and stores nothing.
 */

const STORAGE_BUCKET = "contracts";
const SEVERITY_ORDER: Record<string, number> = { high: 0, medium: 1, low: 2, note: 3 };

/** What the redline will do with one change. */
export interface PlacementVerdict {
  placed: boolean;
  /** Why the change has no place, or null when it has one. */
  reason: UnappliedReason | null;
  /** One sentence in plain language. */
  detail: string;
  /** The change this one overlaps, when that is the reason. */
  conflictsWith: string | null;
  /** Each place the quote was found, when nothing says which is meant. */
  places: { before: string; match: string; after: string }[] | null;
  /** Contract wording the change strikes beyond the finding's quote. */
  alsoStrikes: string | null;
  /** The wording the redline inserts, when it differs from the card's. */
  redlineLanguage: string | null;
}

export interface DryRun {
  verdicts: Map<string, PlacementVerdict>;
  /** Why the whole Word file would be discarded for the marked-up PDF, or null when it wouldn't. */
  fallbackReason: string | null;
}

/** One finding as the review screen holds it, with the associate's latest decision. */
export interface DryRunRow {
  id: string;
  clause_type: string;
  severity: RevisionFinding["severity"];
  category?: Category | null;
  is_missing_clause: boolean;
  quoted_text: string | null;
  location_section: string | null;
  finding_text: string;
  cd_standard: string;
  proposed_language: string | null;
  current_action: { action: string; edited_language: string | null; edited_quote?: string | null; quote_context?: string | null; by_email?: boolean | null } | null;
}

/**
 * The changes the check covers: every business change with wording that the
 * associate hasn't dismissed or sent by email, in the order the export takes them.
 */
export function dryRunFindings(rows: DryRunRow[]): RevisionFinding[] {
  return rows
    .filter((f) => findingCategory(f) !== "legal")
    .filter((f) => f.current_action?.action !== "dismiss" && !f.current_action?.by_email)
    .sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity])
    .map((f) => {
      const action = f.current_action;
      return {
        id: f.id,
        location_section: f.location_section,
        clause_type: f.clause_type,
        severity: f.severity,
        is_missing_clause: f.is_missing_clause,
        quoted_text: action?.edited_quote ?? f.quoted_text,
        quote_context: action?.quote_context ?? null,
        language: (action?.action === "edit" && action.edited_language ? action.edited_language : f.proposed_language) ?? "",
        finding_text: f.finding_text,
        cd_standard: f.cd_standard,
      };
    })
    .filter((f) => !assertsNoChange(f.language));
}

/** The engine's answer for each change, as the card needs it. */
export async function dryRunRedline(originalBytes: Uint8Array, findings: RevisionFinding[]): Promise<DryRun> {
  const verdicts = new Map<string, PlacementVerdict>();
  let result;
  try {
    result = await generateRedline({ originalDocxBytes: originalBytes, findings, author: "Check before export" });
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    return { verdicts, fallbackReason: `The tracked changes could not be generated: ${message}` };
  }

  const languageOf = new Map(findings.map((f) => [f.id, f.language]));
  for (const r of result.resolutions) {
    verdicts.set(r.findingId, {
      placed: r.reason === null,
      reason: r.reason,
      detail: r.detail,
      conflictsWith: r.conflictsWith ?? null,
      places: r.places?.map(({ before, match, after }) => ({ before, match, after })) ?? null,
      alsoStrikes: r.alsoStrikes ?? null,
      redlineLanguage: r.wording !== undefined && r.wording !== languageOf.get(r.findingId)?.trim() ? r.wording : null,
    });
  }

  const report = await validateRedline({ originalBytes, engineResult: result, author: "Check before export" });
  return { verdicts, fallbackReason: report.outcome === "fallback" ? report.fallbackReason : null };
}

/**
 * The check for one review, or null when it has no Word file to mark up. Cached
 * until a change's wording, quote or decision moves.
 */
export async function dryRunFor(
  admin: ReturnType<typeof createAdminClient>,
  analysis: { id: string; source_format: string; intake_route: string | null; original_storage_path: string | null },
  rows: DryRunRow[]
): Promise<DryRun | null> {
  if (analysis.source_format !== "docx" || analysis.intake_route === "pdf" || !analysis.original_storage_path) return null;
  const path = analysis.original_storage_path;
  const findings = dryRunFindings(rows);

  return cachedBuild(`${analysis.id}:dry-run`, fingerprint([path, findings]), async () => {
    const { data: blob, error } = await admin.storage.from(STORAGE_BUCKET).download(path);
    if (error || !blob) return { verdicts: new Map(), fallbackReason: null };
    return dryRunRedline(new Uint8Array(await blob.arrayBuffer()), findings);
  });
}
