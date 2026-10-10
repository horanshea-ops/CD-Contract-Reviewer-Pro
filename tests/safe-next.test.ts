import { describe, expect, it } from "vitest";
import { safeNext } from "@/lib/safe-next";

describe("safeNext", () => {
  it("follows an in-app path", () => {
    expect(safeNext("/account")).toBe("/account");
    expect(safeNext("/analyses/abc?tab=2")).toBe("/analyses/abc?tab=2");
    expect(safeNext("/analyses/abc?tab=2#notes")).toBe("/analyses/abc?tab=2#notes");
  });

  it("falls back to the dashboard when there is no path", () => {
    expect(safeNext(null)).toBe("/");
    expect(safeNext("")).toBe("/");
  });

  it("refuses anything that leads to another site", () => {
    expect(safeNext("https://evil.example")).toBe("/");
    expect(safeNext("//evil.example")).toBe("/");
    expect(safeNext("///evil.example")).toBe("/");
    expect(safeNext("/\\evil.example")).toBe("/");
    expect(safeNext("/\\/evil.example")).toBe("/");
    expect(safeNext("javascript:alert(1)")).toBe("/");
    expect(safeNext("data:text/html,x")).toBe("/");
  });

  // A browser drops tabs and newlines from a link before it reads it.
  it.each(["\t", "\n", "\r", "\r\n"])("refuses a path that hides another site behind %j", (gap) => {
    expect(safeNext(`/${gap}/evil.example`)).toBe("/");
    expect(safeNext(`/${gap}\\evil.example`)).toBe("/");
    expect(safeNext(`${gap}//evil.example`)).toBe("/");
  });

  it("refuses a value with a leading space", () => {
    expect(safeNext(" //evil.example")).toBe("/");
    expect(safeNext(" /account")).toBe("/");
  });

  it("refuses a path that cleans to another site", () => {
    expect(safeNext("/.//evil.example")).toBe("/");
    expect(safeNext("/..//evil.example")).toBe("/");
    expect(safeNext("/a/..//evil.example")).toBe("/");
  });

  it("returns the path as a browser reads it", () => {
    expect(safeNext("/account\t")).toBe("/account");
    expect(safeNext("/a/../account")).toBe("/account");
  });

  it("leaves an address inside the query alone", () => {
    expect(safeNext("/?next=//evil.example")).toBe("/?next=//evil.example");
    expect(safeNext("/%09/evil.example")).toBe("/%09/evil.example");
  });

  it("never returns a value that leaves the app, whatever goes in", () => {
    const pieces = ["/", "\\", "\t", "\n", ".", "..", "evil.example", "@", ":", "?", "#", "%2F", " "];
    for (const a of pieces) {
      for (const b of pieces) {
        for (const c of pieces) {
          const out = safeNext(`/${a}${b}${c}evil.example`);
          expect(new URL(out, "https://app.example").origin).toBe("https://app.example");
        }
      }
    }
  });
});
