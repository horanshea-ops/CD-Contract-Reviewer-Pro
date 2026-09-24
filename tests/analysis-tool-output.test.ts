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
      response({ findings: JSON.stringify([FINDING]), clauses_checked: ["attrition"], document_notes: "" })
    );
    const result = await run();
    expect(create).toHaveBeenCalledTimes(1);
    expect(result.findings).toEqual([FINDING]);
  });

  it("retries, then says what the malformed field held", async () => {
    const broken = response({ findings: "[{ not json", clauses_checked: [] });
    create.mockResolvedValueOnce(broken).mockResolvedValueOnce(broken);
    await expect(run()).rejects.toThrow(
      /Got findings: text of 11 characters starting "\[\{ not json", clauses_checked: list of 0\. stop_reason=tool_use, output_tokens=23108/
    );
    expect(create).toHaveBeenCalledTimes(2);
  });

  it("reports a missing field as absent", async () => {
    const broken = response({ clauses_checked: [] });
    create.mockResolvedValueOnce(broken).mockResolvedValueOnce(broken);
    await expect(run()).rejects.toThrow(/Got findings: absent/);
  });
});
