/**
 * When a run in flight has stopped being a run in flight.
 *
 * `processAnalysis` marks its own failures, but that write needs the network
 * the failure may have taken out — a dropped connection leaves the row at
 * "processing" with no error and nothing to end it. The review screen then
 * polls forever. So the age of the run decides, not the row's own account of
 * itself.
 */

/** Past the model budget below, with room for the saves after it. */
export const STALE_ANALYSIS_MINUTES = 10;

/**
 * How long the model call may run, counted from the start of processAnalysis.
 * It ends well before the stall check above, so a slow review fails with an
 * error instead of sitting at "processing" until the associate retries.
 *
 * Seven minutes fits one slow attempt and a retry. The longest single attempt
 * measured is 253s, on the synthetic eval corpus. The routes' maxDuration
 * leaves room for the upload before and the saves after.
 */
export const MODEL_CALL_BUDGET_MS = 420_000;

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
