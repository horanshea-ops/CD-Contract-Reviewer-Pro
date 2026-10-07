import { createHash } from "node:crypto";
import { createAdminClient } from "../supabase/admin";
import { DEFAULT_SET, type StandardSet } from "./sets";
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
 *
 * The library is split into sets by hotel brand (lib/standards/sets.ts). A
 * review reads one set and nothing from any other. A set that is switched off,
 * empty or unknown gives the default set, and `setNote` says why. The hash
 * covers a set's entries and not its key, so the default set's hash is what it
 * was before sets existed.
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
  /** The set whose standards these are. */
  set: string;
  /** The set that was asked for. */
  requestedSet: string;
  /** Why the set used is not the set asked for, in words an associate can read. */
  setNote?: string;
}

/**
 * Field order and row order are fixed here so the hash tracks content, not incidental ordering.
 *
 * compromise_range is left out because the model never reads it, so editing it
 * changes no review output.
 */
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
      e.category,
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

const COLUMNS =
  "clause_type, segment, category, position, fallback_language, walk_away_condition, severity_default, compromise_range, version, provenance";

/** The bundled library, which stands in for the default set. */
function bundled(requestedSet: string, fallbackReason?: string): LoadedStandards {
  return {
    entries: STANDARDS_LIBRARY,
    version: STANDARDS_LIBRARY_VERSION,
    source: "bundled_fallback",
    hash: hashStandards(STANDARDS_LIBRARY),
    fallbackReason,
    set: DEFAULT_SET,
    requestedSet,
    setNote: requestedSet === DEFAULT_SET ? undefined : `The standards library couldn't be read, so this review used Independent.`,
  };
}

type SetRow = Pick<StandardSet, "key" | "name" | "is_default" | "is_active">;

/**
 * The set a review may read, and why when it isn't the one asked for. A set
 * counts only when it exists, is switched on, and holds a standard.
 */
function chooseSet(
  requested: string,
  sets: SetRow[],
  holds: (key: string) => boolean
): { key: string; note?: string } {
  const fallback = sets.find((s) => s.is_default) ?? { key: DEFAULT_SET, name: "Independent" };
  if (requested === fallback.key) return { key: fallback.key };

  const wanted = sets.find((s) => s.key === requested);
  const used = `so this review used ${fallback.name}.`;
  if (!wanted) return { key: fallback.key, note: `There is no standards set called ${requested}, ${used}` };
  if (!wanted.is_active) return { key: fallback.key, note: `${wanted.name}'s standards are switched off, ${used}` };
  if (!holds(wanted.key)) return { key: fallback.key, note: `${wanted.name} has no standards yet, ${used}` };
  return { key: wanted.key };
}

export async function loadStandardsLibrary(setKey: string = DEFAULT_SET): Promise<LoadedStandards> {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    // Headless scripts (scripts/test-analysis.ts) run without database env.
    return bundled(setKey, "Supabase environment variables are not set.");
  }

  try {
    const admin = createAdminClient();
    const [sets, rows] = await Promise.all([
      admin.from("standard_sets").select("key, name, is_default, is_active"),
      admin.from("standards").select(`set_key, ${COLUMNS}`).is("retired_at", null),
    ]);

    if (sets.error) return bundled(setKey, `Could not read the standards sets: ${sets.error.message}`);
    if (rows.error) return bundled(setKey, `Could not read the standards table: ${rows.error.message}`);

    const all = (rows.data ?? []) as (StandardEntry & { set_key: string })[];
    const chosen = chooseSet(setKey, (sets.data ?? []) as SetRow[], (key) => all.some((row) => row.set_key === key));

    // The set's key stays out of each entry, since the entries are what the model reads and the hash covers.
    const entries: StandardEntry[] = all.filter((row) => row.set_key === chosen.key).map(({ set_key, ...entry }) => (void set_key, entry));
    if (entries.length === 0) {
      return bundled(setKey, "The standards table is empty — run `npm run standards:seed`.");
    }

    return {
      entries,
      // Every seeded row shares one version string; read it rather than assuming.
      version: entries[0].version ?? STANDARDS_LIBRARY_VERSION,
      source: "database",
      hash: hashStandards(entries),
      set: chosen.key,
      requestedSet: setKey,
      setNote: chosen.note,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return bundled(setKey, `Could not reach the database: ${message}`);
  }
}
