import { describe, expect, it } from "vitest";
import { buildClientEmailPrompt } from "@/lib/anthropic";

describe("buildClientEmailPrompt", () => {
  const prompt = buildClientEmailPrompt();

  it("instructs plain business language, not clause numbers", () => {
    expect(prompt).toMatch(/plain business language/i);
  });

  it("instructs grouping by theme rather than document order", () => {
    expect(prompt).toMatch(/group findings by theme/i);
    expect(prompt).toMatch(/not in document order/i);
  });

  it("instructs including quantified exposure figures with their basis", () => {
    expect(prompt).toMatch(/dollar exposure/i);
    expect(prompt).toMatch(/basis/i);
  });

  it("instructs a thematic summary rather than one bullet per finding", () => {
    expect(prompt).toMatch(/thematic summary/i);
  });

  it("prohibits any statement of legal effect", () => {
    expect(prompt).toMatch(/statement of legal effect/i);
  });

  it("prohibits \"protected\"/\"covered\" assurances", () => {
    expect(prompt).toMatch(/protected/i);
    expect(prompt).toMatch(/covered/i);
  });

  it("prohibits characterizing what a clause legally means", () => {
    expect(prompt).toMatch(/characterization of what a clause legally/i);
  });

  it("never claims to be legal advice", () => {
    expect(prompt).toMatch(/not legal advice/i);
  });
});
