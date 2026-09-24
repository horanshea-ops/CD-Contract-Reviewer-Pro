import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { analyzeContract } from "@/lib/anthropic";
import { STANDARDS_LIBRARY, STANDARDS_LIBRARY_VERSION } from "@/lib/standards/v1";

/**
 * The review's time budget. A retry that starts too late is cut off mid-run
 * and leaves the analysis at "processing" with no error. So a run that fails
 * late ends with a clear error instead.
 */

const { create } = vi.hoisted(() => ({ create: vi.fn() }));

vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = { create };
  },
}));

const ok = {
  content: [{ type: "tool_use", id: "toolu_1", name: "record_analysis", input: { findings: [], clauses_checked: [], document_notes: "" } }],
  stop_reason: "tool_use",
  usage: { input_tokens: 0, output_tokens: 0 },
};

const T0 = Date.parse("2026-09-22T12:00:00Z");

const run = (deadline?: number) =>
  analyzeContract({
    document: { kind: "text", text: "CONTRACT BODY" },
    standards: STANDARDS_LIBRARY,
    standardsVersion: STANDARDS_LIBRARY_VERSION,
    deadline,
  });

/** A model call that fails after `ms` of simulated time. */
const failAfter = (ms: number) => async () => {
  vi.setSystemTime(Date.now() + ms);
  throw new Error("overloaded");
};

beforeEach(() => {
  create.mockReset();
  vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(T0);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
});

describe("analyzeContract's time budget", () => {
  it("bounds each attempt by the deadline and turns off the SDK's own retries", async () => {
    create.mockResolvedValueOnce(ok);
    await run(T0 + 240_000);
    expect(create.mock.calls[0][1]).toEqual({ timeout: 240_000, maxRetries: 0 });
  });

  it("retries a fast failure within what is left", async () => {
    create.mockImplementationOnce(failAfter(5_000)).mockResolvedValueOnce(ok);
    await run(T0 + 240_000);
    expect(create).toHaveBeenCalledTimes(2);
    expect(create.mock.calls[1][1]).toEqual({ timeout: 235_000, maxRetries: 0 });
  });

  it("fails clearly, without retrying, when a slow failure leaves too little time", async () => {
    create.mockImplementationOnce(failAfter(150_000));
    await expect(run(T0 + 240_000)).rejects.toThrow(/too little time left to try again \(overloaded\)/);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("keeps the SDK's defaults and always retries when no deadline is given", async () => {
    create.mockImplementationOnce(failAfter(500_000)).mockResolvedValueOnce(ok);
    await run();
    expect(create).toHaveBeenCalledTimes(2);
    expect(create.mock.calls[0][1]).toBeUndefined();
  });
});
