import { describe, expect, it } from "vitest";
import { nextRoundLinkage } from "@/lib/negotiation-threads";

describe("nextRoundLinkage", () => {
  it("is round 1 with no parent when the thread has no existing rounds", () => {
    expect(nextRoundLinkage("thread-1", [])).toEqual({
      threadId: "thread-1",
      roundNumber: 1,
      parentAnalysisId: null,
    });
  });

  it("increments from the single existing round", () => {
    const result = nextRoundLinkage("thread-1", [{ id: "a1", round_number: 1 }]);
    expect(result).toEqual({ threadId: "thread-1", roundNumber: 2, parentAnalysisId: "a1" });
  });

  it("uses the highest round number regardless of array order", () => {
    const result = nextRoundLinkage("thread-1", [
      { id: "a3", round_number: 3 },
      { id: "a1", round_number: 1 },
      { id: "a2", round_number: 2 },
    ]);
    expect(result).toEqual({ threadId: "thread-1", roundNumber: 4, parentAnalysisId: "a3" });
  });
});
