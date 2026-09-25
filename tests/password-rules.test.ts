import { describe, expect, it } from "vitest";
import { MIN_PASSWORD_LENGTH, passwordProblem } from "@/lib/password-rules";

describe("passwordProblem", () => {
  const good = "x".repeat(MIN_PASSWORD_LENGTH);

  it("accepts a long enough password typed twice", () => {
    expect(passwordProblem(good, good)).toBeNull();
  });

  it("refuses a short password", () => {
    expect(passwordProblem("short", "short")).toBe(`Use at least ${MIN_PASSWORD_LENGTH} characters.`);
  });

  it("refuses two passwords that differ", () => {
    expect(passwordProblem(good, `${good}!`)).toBe("The two passwords don't match.");
  });
});
