/**
 * §1.9.2 — what a new upload's round linkage should be, given the thread it's
 * joining and that thread's existing rounds. Pure function, no DB access, so
 * the actual numbering logic is testable without a live Supabase project —
 * the route handler that calls this does the query and owns the DB write.
 */
export interface ExistingRound {
  id: string;
  round_number: number;
}

export interface RoundLinkage {
  threadId: string;
  roundNumber: number;
  parentAnalysisId: string | null;
}

export function nextRoundLinkage(threadId: string, existingRounds: ExistingRound[]): RoundLinkage {
  if (existingRounds.length === 0) {
    return { threadId, roundNumber: 1, parentAnalysisId: null };
  }
  const latest = existingRounds.reduce((a, b) => (b.round_number > a.round_number ? b : a));
  return { threadId, roundNumber: latest.round_number + 1, parentAnalysisId: latest.id };
}
