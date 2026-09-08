import { describe, expect, it } from "vitest";
import { collapseWhitespace, normalizeChar, normalizeText } from "@/lib/docx/normalize";

/**
 * These matter because §1.5 locates a model-supplied quote by matching it
 * against this normalised text. A character handled differently in the two
 * places is a finding that silently fails to apply.
 */
describe("normalizeChar", () => {
  it("returns at most one character, so callers can assume it", () => {
    const samples = ["a", " ", "’", "­", "“", "‑", "€", "☐", "\n", "\t"];
    for (const ch of samples) expect(normalizeChar(ch).length, ch).toBeLessThanOrEqual(1);
  });

  it("folds curly quotes to straight", () => {
    expect(normalizeChar("‘")).toBe("'");
    expect(normalizeChar("’")).toBe("'");
    expect(normalizeChar("“")).toBe('"');
    expect(normalizeChar("”")).toBe('"');
  });

  it("folds non-breaking hyphens and spaces to ASCII", () => {
    expect(normalizeChar("‑")).toBe("-");
    expect(normalizeChar(" ")).toBe(" ");
    expect(normalizeChar(" ")).toBe(" ");
  });

  it("drops invisible characters entirely", () => {
    for (const ch of ["­", "​", "﻿"]) expect(normalizeChar(ch)).toBe("");
  });

  it("leaves ordinary text, punctuation and symbols alone", () => {
    for (const ch of ["a", "Z", "0", "%", "$", "(", ")", "-", "'", '"', "☐", "€"]) {
      expect(normalizeChar(ch), ch).toBe(ch);
    }
  });

  it("does not touch tabs or newlines, which carry structure", () => {
    expect(normalizeChar("\t")).toBe("\t");
    expect(normalizeChar("\n")).toBe("\n");
  });
});

describe("normalizeText", () => {
  it("makes a Word-pasted clause match its straight-quoted equivalent", () => {
    const fromWord = "The “Group” shall pay non‑commissionable rates at 90 % of the block.";
    expect(normalizeText(fromWord)).toBe('The "Group" shall pay non-commissionable rates at 90 % of the block.');
  });

  it("removes soft hyphens, changing length — which is why mapping is per-character", () => {
    const withSoft = "rea­sonable";
    expect(normalizeText(withSoft)).toBe("reasonable");
    expect(normalizeText(withSoft).length).toBe(withSoft.length - 1);
  });

  it("is idempotent", () => {
    const s = "The “Group” pays non‑commissionable rates.";
    expect(normalizeText(normalizeText(s))).toBe(normalizeText(s));
  });
});

describe("collapseWhitespace", () => {
  it("collapses and trims without being part of the mapped path", () => {
    expect(collapseWhitespace("  a \n\t b  ")).toBe("a b");
  });
});
