import { describe, expect, it } from "vitest";
import {
  MONTHLY_REVIEW_LIMIT,
  allowance,
  limitReachedMessage,
  monthStartUTC,
  nextMonthStartUTC,
} from "@/lib/review-allowance";

describe("allowance", () => {
  const september = new Date("2026-09-24T15:00:00Z");

  it("counts down from the monthly limit", () => {
    expect(allowance(12, september)).toEqual({
      limit: MONTHLY_REVIEW_LIMIT,
      used: 12,
      remaining: MONTHLY_REVIEW_LIMIT - 12,
      month: "September",
      resetsOn: "October 1",
    });
  });

  it("stops at zero when more were used than the limit allows", () => {
    expect(allowance(MONTHLY_REVIEW_LIMIT + 3, september).remaining).toBe(0);
  });

  it("resets on January 1 in December", () => {
    expect(allowance(0, new Date("2026-12-10T00:00:00Z")).resetsOn).toBe("January 1");
  });
});

describe("month edges", () => {
  it("counts the last minute of a month in that month", () => {
    const late = new Date("2026-09-30T23:59:00Z");
    expect(monthStartUTC(late).toISOString()).toBe("2026-09-01T00:00:00.000Z");
    expect(nextMonthStartUTC(late).toISOString()).toBe("2026-10-01T00:00:00.000Z");
  });

  it("starts a new count at midnight UTC on the 1st", () => {
    expect(monthStartUTC(new Date("2026-10-01T00:00:00Z")).toISOString()).toBe("2026-10-01T00:00:00.000Z");
  });
});

describe("limitReachedMessage", () => {
  it("says what was used and when uploads reopen", () => {
    expect(limitReachedMessage(allowance(30, new Date("2026-09-24T15:00:00Z"), 30))).toBe(
      "You've used all 30 reviews for September. Uploads open again on October 1."
    );
  });
});
