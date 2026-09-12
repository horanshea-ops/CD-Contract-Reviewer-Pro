import { describe, expect, it } from "vitest";
import { isAwaitingAiUseDecision, isStalledRun, retryability, STALE_ANALYSIS_MINUTES } from "@/lib/analysis-status";

/**
 * A dropped connection during a live run left an analysis at "processing" with
 * no error, because the write that marks a failure needed the network that had
 * just gone. These rules are what ends that wait.
 */

const NOW = Date.parse("2026-09-12T04:00:00.000Z");
const minutesAgo = (m: number) => new Date(NOW - m * 60_000).toISOString();

const run = (over: Partial<Parameters<typeof isStalledRun>[0]> = {}) => ({
  status: "processing",
  created_at: minutesAgo(1),
  started_at: minutesAgo(1),
  ...over,
});

describe("deciding a run has stopped responding", () => {
  it("leaves a run inside the expected window alone", () => {
    expect(isStalledRun(run({ started_at: minutesAgo(2) }), NOW)).toBe(false);
  });

  it("calls a run stalled once it passes the ceiling", () => {
    expect(isStalledRun(run({ started_at: minutesAgo(STALE_ANALYSIS_MINUTES + 1) }), NOW)).toBe(true);
  });

  it("times a queued run that never started from when it was created", () => {
    expect(isStalledRun({ status: "queued", created_at: minutesAgo(20), started_at: null }, NOW)).toBe(true);
    expect(isStalledRun({ status: "queued", created_at: minutesAgo(1), started_at: null }, NOW)).toBe(false);
  });

  it("never calls a finished run stalled, however old", () => {
    expect(isStalledRun(run({ status: "complete", started_at: minutesAgo(900) }), NOW)).toBe(false);
    expect(isStalledRun(run({ status: "failed", started_at: minutesAgo(900) }), NOW)).toBe(false);
  });

  it("waits indefinitely on the AI-use gate, which waits on a person", () => {
    const gated = run({
      started_at: minutesAgo(120),
      ai_clause_scan_result: { matches: [{ term: "artificial intelligence" }] },
      ai_clause_acknowledged_at: null,
    });
    expect(isAwaitingAiUseDecision(gated)).toBe(true);
    expect(isStalledRun(gated, NOW)).toBe(false);
  });

  it("resumes ageing once that decision is recorded", () => {
    const decided = run({
      started_at: minutesAgo(120),
      ai_clause_scan_result: { matches: [{ term: "artificial intelligence" }] },
      ai_clause_acknowledged_at: minutesAgo(119),
    });
    expect(isStalledRun(decided, NOW)).toBe(true);
  });

  it("does not guess from an unreadable timestamp", () => {
    expect(isStalledRun(run({ started_at: "not a date", created_at: "not a date" }), NOW)).toBe(false);
  });
});

describe("who may be retried", () => {
  const reason = (r: Parameters<typeof retryability>[0]) => {
    const verdict = retryability(r, NOW);
    return verdict.allowed ? null : verdict.reason;
  };

  it("allows a failed run and a stalled one", () => {
    expect(retryability(run({ status: "failed" }), NOW).allowed).toBe(true);
    expect(retryability(run({ started_at: minutesAgo(30) }), NOW).allowed).toBe(true);
  });

  it("refuses a run that is merely still going", () => {
    expect(reason(run({ started_at: minutesAgo(2) }))).toMatch(/still running/);
  });

  it("refuses a completed run, and says what to do instead", () => {
    expect(reason(run({ status: "complete" }))).toMatch(/Upload the contract again/);
  });

  it("refuses a run waiting on the AI-use decision", () => {
    const gated = run({
      started_at: minutesAgo(120),
      ai_clause_scan_result: { matches: [{ term: "machine learning" }] },
    });
    expect(reason(gated)).toMatch(/AI-use decision/);
  });
});
