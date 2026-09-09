import { describe, expect, it } from "vitest";
import { scanForAiUseTerms, scanForAdjacentTerms } from "@/lib/ai-use-scan";

describe("scanForAiUseTerms — false positives", () => {
  it("does not match \\bAI\\b inside ordinary words", () => {
    const text =
      "The chair of the committee confirmed the room block is available. Please review every detail before signing.";
    expect(scanForAiUseTerms(text)).toEqual([]);
  });

  it("does not match plain, unrelated contract language", () => {
    const text =
      "Group agrees to maintain the room block and said rate for the duration of the agreement, as stated above.";
    expect(scanForAiUseTerms(text)).toEqual([]);
  });
});

describe("scanForAiUseTerms — true positives", () => {
  const cases: [string, string][] = [
    ["artificial intelligence", "The Property may not use artificial intelligence to process guest data."],
    ["machine learning", "No machine learning models may be trained on this agreement."],
    ["large language model", "This document may not be summarized by a large language model."],
    ["generative AI", "Use of generative AI tools to draft correspondence is prohibited."],
    ["generative artificial", "Use of generative artificial systems is prohibited."],
    ["automated processing", "Guest data is not subject to automated processing of any kind."],
    ["automated decision", "No automated decision may be made regarding attendee eligibility."],
    ["algorithmic", "Pricing shall not be set by algorithmic means."],
    ["AI", "No AI may be used to review this Agreement."],
    ["LLM", "This Agreement may not be processed by an LLM."],
    ["text mining", "Text mining of this Agreement is prohibited."],
    ["data mining", "Data mining of guest records is prohibited."],
    ["train a model", "Recipient shall not train a model on the contents of this Agreement."],
    ["training any model", "Recipient shall not use this document for training any model."],
    ["natural language processing", "No natural language processing tools may be applied to this Agreement."],
  ];

  it.each(cases)("matches %s", (_label, text) => {
    const matches = scanForAiUseTerms(text);
    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0].excerpt).toContain(matches[0].term);
  });
});

describe("scanForAiUseTerms — excerpt windowing", () => {
  it("does not truncate when the match is near the start of a short text", () => {
    const text = "AI may not be used to review this Agreement in any form.";
    const [match] = scanForAiUseTerms(text);
    expect(match.excerpt).not.toContain("…");
    expect(match.excerpt.slice(match.matchStart, match.matchStart + match.matchLength)).toBe("AI");
  });

  it("ellipsizes both sides when the match is in the middle of a long text", () => {
    const filler = "This is ordinary contract text that goes on for a while. ".repeat(20);
    const text = `${filler}The Group shall not use artificial intelligence for any purpose. ${filler}`;
    const [match] = scanForAiUseTerms(text);
    expect(match.excerpt.startsWith("…")).toBe(true);
    expect(match.excerpt.endsWith("…")).toBe(true);
    const extracted = match.excerpt.slice(match.matchStart, match.matchStart + match.matchLength);
    expect(extracted.toLowerCase()).toBe("artificial intelligence");
  });

  it("never cuts a word in half at the excerpt boundary", () => {
    const filler = "supercalifragilisticexpialidocious ".repeat(30);
    const text = `${filler}machine learning ${filler}`;
    const [match] = scanForAiUseTerms(text);
    const withoutEllipses = match.excerpt.replace(/…/g, "");
    for (const word of withoutEllipses.trim().split(/\s+/)) {
      expect(word === "" || text.includes(word)).toBe(true);
    }
  });
});

describe("scanForAdjacentTerms", () => {
  const cases: [string, string][] = [
    ["third-party processor", "Guest data may not be shared with any third-party processor."],
    ["permitted recipients", "Confidential information may only be shared with permitted recipients."],
    ["confidential information", "Each party shall protect the other's confidential information."],
    ["data residency", "All guest data is subject to data residency requirements."],
    ["data localization", "The Property shall comply with all data localization laws."],
    ["personally identifiable information", "No personally identifiable information may be transferred abroad."],
  ];

  it.each(cases)("matches %s", (_label, text) => {
    expect(scanForAdjacentTerms(text).length).toBeGreaterThan(0);
  });

  it("does not fire on ordinary contract text", () => {
    const text = "The Hotel will hold a block of 200 guest rooms per night for the Group.";
    expect(scanForAdjacentTerms(text)).toEqual([]);
  });
});
