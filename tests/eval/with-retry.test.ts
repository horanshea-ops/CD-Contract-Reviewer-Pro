import { describe, expect, it, vi } from "vitest";
import { costOf, withRetry } from "../../scripts/with-retry";

/**
 * A try that reaches the model is billed whether or not it returns. On
 * 2026-10-07 a slow call was about to retry on its own, unwatched. So the
 * caller says how many tries it will pay for.
 */

describe("withRetry", () => {
  it("makes one try and no more when told to", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const attempt = vi.fn(async () => {
      throw new Error("Request timed out.");
    });

    await expect(withRetry(attempt, 1)).rejects.toThrow("Request timed out.");
    expect(attempt).toHaveBeenCalledTimes(1);
  });

  it("returns the first success without trying again", async () => {
    const attempt = vi.fn(async () => "done");
    expect(await withRetry(attempt, 3)).toBe("done");
    expect(attempt).toHaveBeenCalledTimes(1);
  });
});

describe("costOf", () => {
  it("prices a call from its token counts", () => {
    // The 4 October Harborview run on Sonnet 5.5, which is recorded at $0.475.
    expect(costOf({ input: 32894, output: 40431, cacheRead: 24324 })).toBeCloseTo(0.475, 3);
    expect(costOf({})).toBe(0);
  });
});
