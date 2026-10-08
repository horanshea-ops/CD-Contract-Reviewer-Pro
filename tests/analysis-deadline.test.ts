import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { analyzeContract } from "@/lib/anthropic";
import { STANDARDS_LIBRARY, STANDARDS_LIBRARY_VERSION } from "@/lib/standards/v1";

/**
 * The review's time budget. A retry that starts too late is cut off mid-run
 * and leaves the analysis at "processing" with no error. So a run that fails
 * late ends with a clear error instead.
 *
 * The review is streamed, because Node drops a request that is silent for 300
 * seconds. The SDK's timeout stops covering a stream once it starts, so the
 * deadline stops the stream itself.
 */

const { create, unstreamed, abort, partial } = vi.hoisted(() => ({
  create: vi.fn(),
  unstreamed: vi.fn(),
  abort: vi.fn(),
  partial: { content: [] as unknown[] },
}));

/** `create` gives the stream's final message. An aborted stream fails as the SDK's does. */
vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = {
      create: unstreamed,
      stream: (...args: unknown[]) => {
        let stop: (reason: Error) => void = () => {};
        const stopped = new Promise<never>((_, reject) => (stop = reject));
        return {
          currentMessage: partial,
          abort: () => {
            abort();
            stop(new Error("Request was aborted."));
          },
          finalMessage: () => Promise.race([create(...args), stopped]),
        };
      },
    };
  },
}));

const ok = {
  content: [{ type: "tool_use", id: "toolu_1", name: "record_analysis", input: { clause_review: [], findings: [], document_notes: "" } }],
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
  unstreamed.mockReset();
  abort.mockReset();
  partial.content = [];
  vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
  vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
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
    expect(abort).not.toHaveBeenCalled();
  });

  it("fails clearly, without retrying, when a slow failure leaves too little time", async () => {
    create.mockImplementationOnce(failAfter(150_000));
    await expect(run(T0 + 240_000)).rejects.toThrow(/too little time left to try again \(overloaded\)/);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("leaves the SDK's defaults in place and always retries when no deadline is given", async () => {
    create.mockImplementationOnce(failAfter(500_000)).mockResolvedValueOnce(ok);
    await run();
    expect(create).toHaveBeenCalledTimes(2);
    expect(create.mock.calls[0][1]).toBeUndefined();
  });
});

describe("analyzeContract's stream", () => {
  it("sends the review as a stream, never as one silent request", async () => {
    create.mockResolvedValueOnce(ok);
    await run(T0 + 240_000);
    expect(create).toHaveBeenCalledTimes(1);
    expect(unstreamed).not.toHaveBeenCalled();
  });

  it("stops a stream still running at the deadline, says how much had arrived, and doesn't retry", async () => {
    create.mockImplementationOnce(() => new Promise(() => {}));
    partial.content = [{ type: "text", text: "x".repeat(1234) }];

    const outcome = expect(run(T0 + 240_000)).rejects.toThrow(/its time ran out.*\(1,234 characters of the answer had arrived\)/);
    await vi.advanceTimersByTimeAsync(239_999);
    expect(abort).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await outcome;

    expect(abort).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("leaves no timer running once the review is back", async () => {
    create.mockResolvedValueOnce(ok);
    await run(T0 + 240_000);
    expect(vi.getTimerCount()).toBe(0);
    expect(abort).not.toHaveBeenCalled();
  });
});
