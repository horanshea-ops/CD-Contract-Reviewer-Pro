import { describe, expect, it } from "vitest";
import { safeNext } from "@/lib/safe-next";

describe("safeNext", () => {
  it("follows an in-app path", () => {
    expect(safeNext("/account")).toBe("/account");
    expect(safeNext("/analyses/abc?tab=2")).toBe("/analyses/abc?tab=2");
  });

  it("falls back to the dashboard when there is no path", () => {
    expect(safeNext(null)).toBe("/");
    expect(safeNext("")).toBe("/");
  });

  it("refuses anything that leads to another site", () => {
    expect(safeNext("https://evil.example")).toBe("/");
    expect(safeNext("//evil.example")).toBe("/");
    expect(safeNext("/\\evil.example")).toBe("/");
    expect(safeNext("javascript:alert(1)")).toBe("/");
  });
});
