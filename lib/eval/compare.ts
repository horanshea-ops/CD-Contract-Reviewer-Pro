import type { ComparedItem, RunComparison, RunHeadline, ScoreReport } from "./types";

/**
 * Comparing a run with earlier runs of the same key (MASTER_PLAN.md §2.0.1).
 *
 * Works on scored reports, so every run is paired and graded the same way.
 * "Missed" means not matched, the same as recall, so a conflated item counts.
 */

function headline(report: ScoreReport): RunHeadline {
  return {
    run_id: report.run_id,
    recall: report.detection.recall,
    matched: report.detection.matched,
    key_items: report.detection.key_items,
    redline: report.redline
      ? { applied: report.redline.applied, widened: report.redline.widened, unapplied: report.redline.unapplied }
      : null,
  };
}

function missedIn(report: ScoreReport): Map<string, ComparedItem> {
  const out = new Map<string, ComparedItem>();
  for (const contract of report.contracts) {
    for (const miss of contract.missed) {
      out.set(miss.key_item_id, {
        key_item_id: miss.key_item_id,
        contract: contract.contract,
        clause_type: miss.clause_type,
        severity: miss.severity,
      });
    }
  }
  return out;
}

export function compareRuns(current: ScoreReport, baselines: ScoreReport[]): RunComparison {
  if (baselines.length === 0) throw new Error("Name at least one baseline run to compare against.");
  if (baselines.some((b) => b.key_version !== current.key_version)) {
    throw new Error("Every baseline must be scored against the same answer key as the run.");
  }

  const missedNow = missedIn(current);
  const missedBefore = baselines.map(missedIn);

  const [first, ...rest] = missedBefore;
  const repeat_misses = [...first.values()]
    .filter((item) => rest.every((m) => m.has(item.key_item_id)))
    .map((item) => ({ ...item, caught_now: !missedNow.has(item.key_item_id) }));

  const new_misses = [...missedNow.values()].filter((item) => missedBefore.every((m) => !m.has(item.key_item_id)));

  return {
    current: headline(current),
    baselines: baselines.map(headline),
    repeat_misses,
    new_misses,
  };
}
