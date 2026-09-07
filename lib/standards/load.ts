import { createHash } from "node:crypto";
import { createAdminClient } from "../supabase/admin";
import { STANDARDS_LIBRARY, STANDARDS_LIBRARY_VERSION } from "./v1";
import type { StandardEntry } from "./types";

/**
 * Loads the standards library that will actually be sent to the model.
 *
 * The `standards` table is the source of truth, so that a senior associate
 * editing an entry in the admin screen changes how contracts are reviewed.
 * Before this existed the model always read the bundled `v1.ts` array, and the
 * admin screen edited a table nothing consumed — edits appeared to save and
 * changed nothing (recorded in ROADMAP.md).
 *
 * Two consequences worth understanding:
 *
 *  - `version` alone no longer identifies what produced a finding. Every row
 *    shares "v1-industry-default" (it is the seed script's conflict key), so an
 *    admin edit changes the library's content without changing its version.
 *    `hash` closes that gap: it fingerprints the exact entries sent, which is
 *    what the build brief's §6 traceability requirement actually needs.
 *  - The bundled array remains a fallback for when the table is empty or
 *    unreachable. That path is reported in `source`, never silently — build
 *    brief §14's failure mode is "the stage-1 library ships by accident."
 */

export type StandardsSource = "database" | "bundled_fallback";

export interface LoadedStandards {
  entries: StandardEntry[];
  version: string;
  source: StandardsSource;
  /** SHA-256 over the canonical form — identifies the exact content sent. */
  hash: string;
  /** Set when the database was expected but could not be used. */
  fallbackReason?: string;
}

/** Field order and row order are fixed here so the hash tracks content, not incidental ordering. */
function canonicalize(entries: StandardEntry[]): string {
  const sorted = [...entries].sort((a, b) =>
    a.clause_type === b.clause_type
      ? a.segment.localeCompare(b.segment)
      : a.clause_type.localeCompare(b.clause_type)
  );

  return JSON.stringify(
    sorted.map((e) => [
      e.clause_type,
      e.segment,
      e.position,
      e.fallback_language,
      e.walk_away_condition,
      e.severity_default,
      e.version,
      e.provenance,
    ])
  );
}

export function hashStandards(entries: StandardEntry[]): string {
  return createHash("sha256").update(canonicalize(entries)).digest("hex");
}

function bundled(fallbackReason?: string): LoadedStandards {
  return {
    entries: STANDARDS_LIBRARY,
    version: STANDARDS_LIBRARY_VERSION,
    source: "bundled_fallback",
    hash: hashStandards(STANDARDS_LIBRARY),
    fallbackReason,
  };
}

export async function loadStandardsLibrary(): Promise<LoadedStandards> {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    // Headless scripts (scripts/test-analysis.ts) run without database env.
    return bundled("Supabase environment variables are not set.");
  }

  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("standards")
      .select(
        "clause_type, segment, position, fallback_language, walk_away_condition, severity_default, version, provenance"
      );

    if (error) return bundled(`Could not read the standards table: ${error.message}`);
    if (!data || data.length === 0) {
      return bundled("The standards table is empty — run `npm run standards:seed`.");
    }

    const entries = data as StandardEntry[];
    return {
      entries,
      // Every seeded row shares one version string; read it rather than assuming.
      version: entries[0].version ?? STANDARDS_LIBRARY_VERSION,
      source: "database",
      hash: hashStandards(entries),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return bundled(`Could not reach the database: ${message}`);
  }
}
