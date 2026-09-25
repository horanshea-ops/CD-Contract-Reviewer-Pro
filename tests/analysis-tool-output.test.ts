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

const run = (text = "CONTRACT BODY") =>
  analyzeContract({
    document: { kind: "text", text },
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

  it("works exposure figures out from the contract's checked figures, and notes arrive as short items", async () => {
    const contract = [
      "The Room Block totals 2,850 room nights.",
      "Run of House: $149.00 per night.",
      "You agree that you will use at least 2,280 room nights (the \"Minimum Number of Room Nights\").",
      "The fee is the shortfall, times the Group Room Rate, times 80%.",
    ].join("\n");
    const figure = (value: number, quoted_text: string) => ({ value, quoted_text });
    create.mockResolvedValueOnce(
      response({
        // The model's own figure is ignored; only the app's calculation reaches the finding.
        findings: [{ ...FINDING, exposure_amount: 91200, exposure_formula: "2280 * 149 * 0.10" }],
        clause_review: [{ clause_type: "attrition", verdict: "falls_short", basis: "Threshold is 90%." }],
        document_notes: [{ headline: "Meeting dates disagree. One table says 2010.", detail: "Everything else says 2015." }],
        other_findings: [],
        deal_figures: {
          room_block_room_nights: figure(2850, "The Room Block totals 2,850 room nights."),
          group_rate_usd: figure(149, "Run of House: $149.00 per night."),
          minimum_room_nights: figure(2280, "at least 2,280 room nights"),
          attrition_threshold_pct: null,
          // A quote that states a different figure is dropped, so no exposure rests on it.
          attrition_damages_pct: figure(80, "times the Group Room Rate, times 80%"),
          cancellation_tiers: [],
          fb_minimum_usd: figure(100000, "a $50,000 minimum"),
          fb_shortfall_pct: null,
        },
      })
    );
    const result = await run(contract);
    expect(result.findings[0]).toMatchObject({ exposure_amount: 33972, exposure_formula: "(2280 - 1995) * $149 * 0.8" });
    expect(result.deal_figures).toMatchObject({ minimum_room_nights: 2280, attrition_damages_pct: 0.8, fb_minimum_usd: null });
    expect(result.document_notes).toEqual([
      { headline: "Meeting dates disagree.", detail: "One table says 2010. Everything else says 2015." },
    ]);
  });

  it("adds terms outside the library after the library's findings, as wordless Other findings", async () => {
    create.mockResolvedValueOnce(
      response({
        findings: [FINDING],
        clause_review: [{ clause_type: "attrition", verdict: "falls_short", basis: "Threshold is 90%." }],
        document_notes: [],
        other_findings: [
          {
            headline: "Breaching any other agreement ends this one",
            quoted_text: "If you fail to perform under any other agreement between us, we may terminate this Agreement.",
            finding_text: "An unrelated missed payment would let the hotel cancel.",
          },
        ],
      })
    );
    const result = await run();
    expect(result.findings.map((f) => [f.clause_type, f.severity, f.proposed_language])).toEqual([
      ["attrition", FINDING.severity, FINDING.proposed_language],
      ["general", "note", ""],
    ]);
    expect(result.review_gaps.filter((g) => g.clause_type === "general")).toEqual([]);
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
