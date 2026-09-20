import { describe, expect, it } from "vitest";
import { levenshtein, similarityOf } from "@/lib/text-similarity";

describe("levenshtein", () => {
  it("counts single-character edits", () => {
    expect(levenshtein("kitten", "sitting")).toBe(3);
    expect(levenshtein("same", "same")).toBe(0);
  });

  it("falls back to length when one side is empty", () => {
    expect(levenshtein("", "abcd")).toBe(4);
    expect(levenshtein("abcd", "")).toBe(4);
  });
});

describe("similarityOf", () => {
  it("scores 1 for identical text and near 1 for a small edit", () => {
    expect(similarityOf("seventy percent (70%)", "seventy percent (70%)")).toBe(1);
    expect(similarityOf("seventy percent (70%)", "seventy percent (75%)")).toBeGreaterThan(0.9);
  });

  it("treats two empty strings as identical rather than returning NaN", () => {
    expect(similarityOf("", "")).toBe(1);
  });

  it("scores nothing in common at 0", () => {
    expect(similarityOf("aaaa", "bbbb")).toBe(0);
  });
});
