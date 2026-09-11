import { USABLE_VERIFICATIONS, type ScheduleTier, type TermCatalog, type TermValue, type Verification } from "../../terms/types";
import {
  NOT_STATED,
  type KeyedValue,
  type TermOutcome,
  type TermResult,
  type TermsContractResult,
  type TermsKey,
  type TermsRunRecord,
  type TermsScoreReport,
  type TermsTally,
} from "./types";

/**
 * Scores a term extraction run against a key (MASTER_PLAN.md §2.0.2).
 *
 * The key and the catalog arrive as arguments and nothing here reads a file, so
 * a hand-written key for a real contract scores exactly as the synthetic one
 * does. Pure: the same run scored twice gives the same report.
 */

const emptyTally = (): TermsTally => ({
  keyed_values: 0,
  correct: 0,
  wrong_value: 0,
  conflict: 0,
  missed: 0,
  keyed_absent: 0,
  correct_absent: 0,
  invented: 0,
  silent_wrong: 0,
});

const sameNumber = (a: number, b: number) => Math.abs(a - b) < 1e-6;

/** Tiers compared by band and percentage, in band order. Labels are wording, not value. */
function sameSchedule(a: ScheduleTier[], b: ScheduleTier[]): boolean {
  if (a.length !== b.length) return false;
  const order = (tiers: ScheduleTier[]) => [...tiers].sort((x, y) => y.days_prior_min - x.days_prior_min);
  const [x, y] = [order(a), order(b)];
  return x.every(
    (t, i) =>
      t.days_prior_min === y[i].days_prior_min && t.days_prior_max === y[i].days_prior_max && sameNumber(t.pct, y[i].pct)
  );
}

export function sameValue(kind: string, a: TermValue, b: TermValue): boolean {
  if (kind === "number") return typeof a === "number" && typeof b === "number" && sameNumber(a, b);
  if (kind === "schedule") return Array.isArray(a) && Array.isArray(b) && sameSchedule(a, b);
  return a === b;
}

const usable = (v: Verification) => USABLE_VERIFICATIONS.includes(v);

function judge(kind: string, expected: KeyedValue, got: TermResult["got"]): { outcome: TermOutcome; silent_wrong: boolean } {
  if (expected === NOT_STATED) {
    if (got.length === 0) return { outcome: "correct_absent", silent_wrong: false };
    return { outcome: "invented", silent_wrong: got.some((g) => usable(g.verification)) };
  }
  if (got.length === 0) return { outcome: "missed", silent_wrong: false };
  if (got.length > 1) return { outcome: "conflict", silent_wrong: false };
  if (sameValue(kind, got[0].value, expected)) return { outcome: "correct", silent_wrong: false };
  return { outcome: "wrong_value", silent_wrong: usable(got[0].verification) };
}

function add(tally: TermsTally, result: TermResult) {
  if (result.expected === NOT_STATED) tally.keyed_absent += 1;
  else tally.keyed_values += 1;
  tally[result.outcome] += 1;
  if (result.silent_wrong) tally.silent_wrong += 1;
}

export function scoreTermsRun({
  key,
  run,
  catalog,
}: {
  key: TermsKey;
  run: TermsRunRecord;
  catalog: TermCatalog;
}): TermsScoreReport {
  const kindOf = new Map(catalog.terms.map((t) => [t.key, t.kind]));
  const documents = new Map(run.documents.map((d) => [d.contract, d]));

  const versions = new Set([key.catalog_version, run.catalog_version, catalog.version]);
  const catalog_mismatch =
    versions.size > 1
      ? `Key built against ${key.catalog_version}, run against ${run.catalog_version}, scored with ${catalog.version}.`
      : null;

  const verification: Record<Verification, number> = { verified: 0, located: 0, contradicted: 0, unlocated: 0 };
  const total = emptyTally();
  const byKind = new Map<string, TermsTally>();
  const tokens = { input: 0, output: 0, cache_read: 0, cache_creation: 0 };

  const contracts: TermsContractResult[] = key.contracts.map((entry) => {
    const doc = documents.get(entry.contract);
    const stated = doc?.terms?.stated ?? [];
    for (const t of stated) verification[t.verification] += 1;
    for (const k of Object.keys(tokens) as (keyof typeof tokens)[]) tokens[k] += doc?.tokens?.[k] ?? 0;

    const tally = emptyTally();
    const results: TermResult[] = Object.entries(entry.terms).map(([termKey, expected]) => {
      const kind = kindOf.get(termKey);
      if (!kind) throw new Error(`The key scores "${termKey}", which catalog ${catalog.version} does not have.`);

      const got = stated
        .filter((t) => t.term_key === termKey)
        .map((t) => ({ value: t.value, verification: t.verification, quoted_text: t.quoted_text }));
      const result: TermResult = { term_key: termKey, kind, expected, got, ...judge(kind, expected, got) };

      add(tally, result);
      add(total, result);
      const kindTally = byKind.get(kind) ?? emptyTally();
      add(kindTally, result);
      byKind.set(kind, kindTally);
      return result;
    });

    return {
      contract: entry.contract,
      error: doc ? doc.error : "Not in the run.",
      results,
      tally,
      unkeyed_stated: stated.filter((t) => !(t.term_key in entry.terms)).length,
      rejected: doc?.terms?.rejected.length ?? 0,
      tokens: doc?.tokens ?? null,
    };
  });

  return {
    key_version: key.version,
    key_source: key.source,
    run_id: run.run_id,
    run_created_at: run.created_at,
    model_id: run.model_id,
    catalog_version: run.catalog_version,
    catalog_mismatch,
    scored_at: new Date().toISOString(),
    tally: total,
    by_kind: [...byKind.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([kind, tally]) => ({ kind, tally })),
    verification,
    contracts,
    tokens,
  };
}
