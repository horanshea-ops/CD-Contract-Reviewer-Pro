import { describe, expect, it } from "vitest";
import { buildPropertyEmailPrompt } from "@/lib/anthropic";

/**
 * The allowlist is what actually keeps CD's position out of this email; these
 * tests cover the prompt's separate job, which is tone and not inventing
 * reasoning the payload never contained.
 */
describe("buildPropertyEmailPrompt", () => {
  const prompt = buildPropertyEmailPrompt();

  it("names the property as the audience and asks for a courteous tone", () => {
    expect(prompt).toMatch(/audience: the property/i);
    expect(prompt).toMatch(/courteous/i);
  });

  it("asks for the three-part structure §1.8.3 specifies", () => {
    expect(prompt).toMatch(/marked-up copy is attached/i);
    expect(prompt).toMatch(/items addressed/i);
    expect(prompt).toMatch(/offer to discuss/i);
  });

  it("asks for neutral descriptions of what changed, not why", () => {
    expect(prompt).toMatch(/neutral, factual terms/i);
    expect(prompt).toMatch(/what changed, never why/i);
  });

  it("forbids inventing reasoning it was never given", () => {
    expect(prompt).toMatch(/do not state or speculate about reasoning/i);
    expect(prompt).toMatch(/must not invent it/i);
  });

  it("forbids signalling how firm or important CD's position is", () => {
    expect(prompt).toMatch(/how firm CD's position is/i);
    expect(prompt).toMatch(/do not rank, prioritise/i);
    expect(prompt).toMatch(/treat every item as equal in weight/i);
  });

  it("forbids characterising legal effect", () => {
    expect(prompt).toMatch(/do not characterise the legal effect/i);
  });

  it("forbids describing the changes as agreed or final", () => {
    expect(prompt).toMatch(/agreed, final or accepted/i);
  });

  it("asks for brevity", () => {
    expect(prompt).toMatch(/keep it short/i);
  });

  it("leaves the sign-off to the separately appended signature", () => {
    expect(prompt).toMatch(/do not write a sign-off/i);
    expect(prompt).toMatch(/appended separately/i);
  });
});

describe("buildPropertyEmailPrompt placeholder handling", () => {
  const prompt = buildPropertyEmailPrompt();

  it("forbids bracketed placeholders and invented detail", () => {
    expect(prompt).toMatch(/do not leave bracketed placeholders/i);
    expect(prompt).toMatch(/do not invent a detail to fill a gap/i);
  });
});
