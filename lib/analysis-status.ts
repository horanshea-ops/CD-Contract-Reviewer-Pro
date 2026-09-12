/**
 * When a run in flight has stopped being a run in flight.
 *
 * `processAnalysis` marks its own failures, but that write needs the network
 * the failure may have taken out — a dropped connection leaves the row at
 * "processing" with no error and nothing to end it. The review screen then
 * polls forever. So the age of the run decides, not the row's own account of
 * itself.
 */

/** The route's own ceiling is 300s, and the screen promises 1-3 minutes. */
export const STALE_ANALYSIS_MINUTES = 6;

export interface AnalysisRun {
  status: string;
  created_at: string;
  started_at?: string | null;
  ai_clause_scan_result?: { matches?: unknown[] } | null;
  ai_clause_acknowledged_at?: string | null;
}

/** A run held at the AI-use gate waits on a person, so it never goes stale. */
export function isAwaitingAiUseDecision(run: AnalysisRun): boolean {
  return (
    run.status === "processing" &&
    !run.ai_clause_acknowledged_at &&
    (run.ai_clause_scan_result?.matches?.length ?? 0) > 0
  );
}

export function isStalledRun(run: AnalysisRun, now: number = Date.now()): boolean {
  if (run.status !== "queued" && run.status !== "processing") return false;
  if (isAwaitingAiUseDecision(run)) return false;

  const since = Date.parse(run.started_at || run.created_at);
  if (Number.isNaN(since)) return false;

  return now - since > STALE_ANALYSIS_MINUTES * 60_000;
}

/** Whether re-running this analysis is allowed, and why not when it isn't. */
export function retryability(run: AnalysisRun, now: number = Date.now()): { allowed: true } | { allowed: false; reason: string } {
  if (run.status === "failed") return { allowed: true };
  if (isStalledRun(run, now)) return { allowed: true };
  if (isAwaitingAiUseDecision(run)) {
    return { allowed: false, reason: "This analysis is waiting on your AI-use decision." };
  }
  if (run.status === "complete") {
    return { allowed: false, reason: "This analysis finished. Upload the contract again to review it afresh." };
  }
  return { allowed: false, reason: "This analysis is still running. Give it a few minutes before retrying." };
}
