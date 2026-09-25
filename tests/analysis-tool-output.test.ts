import { beforeEach, describe, expect, it, vi } from "vitest";
import { analyzeContract } from "@/lib/anthropic";
import { STANDARDS_LIBRARY, STANDARDS_LIBRARY_VERSION } from "@/lib/standards/v1";

/**
 * Reading the review's tool output. A long response sometimes carries a list
 * as a JSON string. Decoding it saves paying for a second review.
 */

const { create } = vi.hoisted(() => ({ create: vi.fn() }));

vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = { create };
  },
}));

const FINDING = {
  clause_type: "attrition",
  is_missing_clause: false,
  severity: "high",
  location_section: null,
  quoted_text: "The threshold is ninety percent (90%).",
  exposure_amount: null,
  exposure_basis: null,
  finding_text: "Too high.",
  cd_standard: "70%.",
  proposed_language: "The threshold is seventy percent (70%).",
  model_confidence: "high",
};

const response = (input: Record<string, unknown>) => ({
  content: [{ type: "tool_use", id: "toolu_1", name: "record_analysis", input }],
  stop_reason: "tool_use",
  usage: { input_tokens: 0, output_tokens: 23_108 },
});

const run = () =>
  analyzeContract({
    document: { kind: "text", text: "CONTRACT BODY" },
    standards: STANDARDS_LIBRARY,
    standardsVersion: STANDARDS_LIBRARY_VERSION,
  });

beforeEach(() => {
  create.mockReset();
  vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("analyzeContract's tool output", () => {
  it("decodes a list sent as a JSON string, without a second review", async () => {
    create.mockResolvedValueOnce(
      response({ findings: JSON.stringify([FINDING]), clause_review: [{ clause_type: "attrition", verdict: "falls_short", basis: "Threshold is 90%." }], document_notes: "" })
    );
    const result = await run();
    expect(create).toHaveBeenCalledTimes(1);
    expect(result.findings).toEqual([{ ...FINDING, exposure_formula: null }]);
  });

  it("works the exposure figure out from its formula, and notes arrive as short items", async () => {
    create.mockResolvedValueOnce(
      response({
        findings: [{ ...FINDING, exposure_amount: 91200, exposure_formula: "2280 * 149 * 0.10" }],
        clause_review: [{ clause_type: "attrition", verdict: "falls_short", basis: "Threshold is 90%." }],
        document_notes: [{ headline: "Meeting dates disagree. One table says 2010.", detail: "Everything else says 2015." }],
      })
    );
    const result = await run();
    expect(result.findings[0]).toMatchObject({ exposure_amount: 33972, exposure_formula: "2280 * 149 * 0.10" });
    expect(result.document_notes).toEqual([
      { headline: "Meeting dates disagree.", detail: "One table says 2010. Everything else says 2015." },
    ]);
  });

  it("retries, then says what the malformed field held", async () => {
    const broken = response({ findings: "[{ not json", clause_review: [] });
    create.mockResolvedValueOnce(broken).mockResolvedValueOnce(broken);
    await expect(run()).rejects.toThrow(
      /Got findings: text of 11 characters starting "\[\{ not json", clause_review: list of 0\. stop_reason=tool_use, output_tokens=23108/
    );
    expect(create).toHaveBeenCalledTimes(2);
  });

  it("reports a missing field as absent", async () => {
    const broken = response({ clause_review: [] });
    create.mockResolvedValueOnce(broken).mockResolvedValueOnce(broken);
    await expect(run()).rejects.toThrow(/Got findings: absent/);
  });
});
