import { beforeEach, describe, expect, it, vi } from "vitest";
import { EXPOSURE_TERM_KEYS } from "@/lib/exposures/figures";
import { EXPOSURE_CATALOG, reviewContract, TIER_CATALOG } from "@/lib/review";
import { STANDARDS_LIBRARY, STANDARDS_LIBRARY_VERSION } from "@/lib/standards/v1";
import { HOTEL_TERM_CATALOG } from "@/lib/terms/catalog";
import { answerName, answerSchema, type ModelRequest } from "./helpers/model-request";

/**
 * One review as two calls. The judging call writes the findings, the reading
 * call records the contract's terms, and the exposures come from those terms.
 */

const { create } = vi.hoisted(() => ({ create: vi.fn() }));

vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = { create };
  },
}));

const CONTRACT = [
  "Total Room Nights: 2,900",
  "Run of House: $149.00 per night.",
  "You agree that you will use at least 2,280 room nights.",
  "The attrition fee is the shortfall times the rate times eighty percent (80%).",
].join("\n");

const finding = (clause_type: string) => ({
  clause_type,
  is_missing_clause: false,
  severity: "high",
  location_section: null,
  quoted_text: "You agree that you will use at least 2,280 room nights.",
  headline: "Too high.",
  finding_text: "Too high.",
  cd_standard: "70%.",
  proposed_language: "You agree that you will use at least 2,030 room nights.",
  redline_note: "Ties damages to the rooms the group actually uses.",
  model_confidence: "high",
});

const toolResponse = (name: string, input: unknown, usage = { input_tokens: 100, output_tokens: 10 }) => ({
  content: [{ type: "tool_use", id: "toolu_1", name, input }],
  stop_reason: "tool_use",
  usage,
});

const analysisResponse = toolResponse("record_analysis", {
  clause_review: [{ clause_type: "attrition", verdict: "falls_short", basis: "The minimum is 2,280." }],
  findings: [finding("attrition"), finding("attrition")],
  flagged_findings: [],
  document_notes: [],
  other_findings: [],
});

const term = (term_key: string, value: unknown, quoted_text: string) => ({ term_key, value, quoted_text, confidence: "high" });

const termsResponse = toolResponse(
  "record_contract_terms",
  {
    terms: [
      term("deal.room_block_room_nights", 2900, "Total Room Nights: 2,900"),
      term("deal.group_rate_usd", 149, "Run of House: $149.00 per night."),
      term("attrition.minimum_room_nights", 2280, "at least 2,280 room nights"),
      term("attrition.liability_rate", 80, "times eighty percent (80%)"),
    ],
  },
  { input_tokens: 400, output_tokens: 40 }
);

const requests = () => create.mock.calls.map((c) => c[0] as ModelRequest);
const readingRequest = () => requests().find((r) => answerName(r) === "record_contract_terms")!;

const run = (extra: Partial<Parameters<typeof reviewContract>[0]> = {}) =>
  reviewContract({
    document: { kind: "text", text: CONTRACT },
    parts: [{ part: "document", text: CONTRACT }],
    standards: STANDARDS_LIBRARY,
    standardsVersion: STANDARDS_LIBRARY_VERSION,
    model: "claude-sonnet-5",
    ...extra,
  });

beforeEach(() => {
  create.mockReset();
  vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
  create.mockImplementation(async (params: ModelRequest) =>
    answerName(params) === "record_analysis" ? analysisResponse : termsResponse
  );
});

describe("reviewContract", () => {
  it("makes one judging call and one reading call", async () => {
    await run();
    expect(requests().map(answerName).sort()).toEqual(["record_analysis", "record_contract_terms"]);
  });

  it("works each exposure out from the reading call's terms, on the first finding of its clause", async () => {
    const review = await run();

    expect(review.findings.map((f) => f.exposure_amount)).toEqual([29800, null]);
    expect(review.findings[0].exposure_formula).toBe("(2280 - 2030) * $149 * 0.8");
    expect(review.deal_figures).toMatchObject({ room_block_room_nights: 2900, group_rate: 149, minimum_room_nights: 2280, currency: "$" });
  });

  it("keeps the two calls' usage apart, so a review's cost counts both", async () => {
    const review = await run();

    expect(review).toMatchObject({ input_tokens: 100, output_tokens: 10 });
    expect(review.reading).toMatchObject({ ok: true, tokens: { input: 400, output: 40 } });
  });

  it("asks the reader for the exposure terms alone unless it is given a wider catalog", async () => {
    await run();
    expect(answerSchema(readingRequest()).properties.terms.items.properties.term_key.enum).toEqual(
      EXPOSURE_CATALOG.terms.map((t) => t.key)
    );
    expect(EXPOSURE_CATALOG.terms).toHaveLength(EXPOSURE_TERM_KEYS.length);

    create.mockClear();
    await run({ catalog: HOTEL_TERM_CATALOG });
    expect(answerSchema(readingRequest()).properties.terms.items.properties.term_key.enum).toHaveLength(
      HOTEL_TERM_CATALOG.terms.length
    );
  });

  it("completes without exposures when the reading call fails, and says why", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    create.mockImplementation(async (params: ModelRequest) => {
      if (answerName(params) === "record_contract_terms") throw new Error("Connection error.");
      return analysisResponse;
    });

    const review = await run();

    expect(review.findings).toHaveLength(2);
    expect(review.findings.map((f) => f.exposure_amount)).toEqual([null, null]);
    expect(review.reading).toEqual({ ok: false, error: "Connection error." });
  });

  it("fails when the judging call fails, whatever the reading call did", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    create.mockImplementation(async (params: ModelRequest) => {
      if (answerName(params) === "record_analysis") throw new Error("Overloaded.");
      return termsResponse;
    });

    await expect(run()).rejects.toThrow("Overloaded.");
  });
});

describe("asking the reader again for the cancellation tier", () => {
  const TIER_QUOTE = "the Minimum Number of Room Nights, times the Group Room Rate, times 90%";
  const CANCEL = [
    CONTRACT,
    `90 Days or Less: ${TIER_QUOTE}`,
    "91 to 180 Days: the Minimum Number of Room Nights, times the Group Room Rate, times 75%",
  ].join("\n");

  const FIGURES = [
    term("deal.room_block_room_nights", 2900, "Total Room Nights: 2,900"),
    term("deal.group_rate_usd", 149, "Run of House: $149.00 per night."),
    term("attrition.minimum_room_nights", 2280, "at least 2,280 room nights"),
  ];
  const PCT = term("cancellation.top_tier_pct", 90, TIER_QUOTE);
  const BASIS = term("cancellation.damages_basis", "gross_revenue", TIER_QUOTE);
  const BASE = term("cancellation.damages_room_nights", "minimum_commitment", TIER_QUOTE);
  const TIER = { label: "closest to arrival", room_pct: 0.9, base: "minimum_room_nights", charges: "rate" };

  const reading = (terms: unknown[], input_tokens: number) => toolResponse("record_contract_terms", { terms }, { input_tokens, output_tokens: 40 });
  const askedFor = (r: ModelRequest) => answerSchema(r).properties.terms.items.properties.term_key.enum;
  const isReask = (r: ModelRequest) => answerName(r) === "record_contract_terms" && askedFor(r).length === TIER_CATALOG.terms.length;
  const readings = () => requests().filter((r) => answerName(r) === "record_contract_terms");

  const answer = (first: unknown[], second: unknown[] | Error) =>
    create.mockImplementation(async (params: ModelRequest) => {
      if (answerName(params) === "record_analysis") return analysisResponse;
      if (!isReask(params)) return reading(first, 400);
      if (second instanceof Error) throw second;
      return reading(second, 300);
    });

  const review = () => run({ document: { kind: "text", text: CANCEL }, parts: [{ part: "document", text: CANCEL }] });

  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("asks once more for the three tier answers when the first reading left one out, and fills it", async () => {
    answer([...FIGURES, PCT, BASE], [PCT, BASIS, BASE]);
    const result = await review();

    expect(readings()).toHaveLength(2);
    expect(askedFor(readings()[1])).toEqual(TIER_CATALOG.terms.map((t) => t.key));
    expect(TIER_CATALOG.terms).toHaveLength(3);
    expect(result.deal_figures?.cancellation_tiers).toEqual([TIER]);
    expect(result.reading).toMatchObject({
      ok: true,
      tokens: { input: 700, output: 80 },
      reask: { asked_for: ["cancellation.damages_basis"], replaced: [], tokens: { input: 300, output: 40 } },
      unanswered: [],
    });
  });

  it("doesn't ask again when the first reading has every tier answer, or has no cancellation terms at all", async () => {
    answer([...FIGURES, PCT, BASIS, BASE], new Error("not reached"));
    expect((await review()).reading).toMatchObject({ ok: true, reask: null });
    expect(readings()).toHaveLength(1);

    create.mockClear();
    answer(FIGURES, new Error("not reached"));
    expect((await review()).reading).toMatchObject({ ok: true, reask: null });
    expect(readings()).toHaveLength(1);
  });

  it("gives no cancellation figure when the two readings disagree", async () => {
    answer([...FIGURES, PCT, BASE], [term("cancellation.top_tier_pct", 75, "times 75%"), BASIS, BASE]);
    const result = await review();

    expect(result.deal_figures?.cancellation_tiers).toEqual([]);
    expect(result.reading).toMatchObject({
      ok: true,
      notes: expect.arrayContaining([{ term_key: "cancellation.top_tier_pct", reason: "The reading gave more than one value for it, so none is used." }]),
    });
  });

  it("lets the second reading's answer stand in for one the first gave unusably", async () => {
    const wrong = term("cancellation.top_tier_pct", 85, TIER_QUOTE);
    answer([...FIGURES, wrong, BASIS, BASE], [PCT, BASIS, BASE]);
    const result = await review();

    expect(result.deal_figures?.cancellation_tiers).toEqual([TIER]);
    expect(result.reading).toMatchObject({
      ok: true,
      reask: { asked_for: ["cancellation.top_tier_pct"], replaced: [{ term_key: "cancellation.top_tier_pct", value: 0.85, verification: "contradicted" }] },
    });
  });

  it("keeps the first reading when the second call fails, and records the failure", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    answer([...FIGURES, PCT, BASE], new Error("Connection error."));
    const result = await review();

    expect(result.findings.map((f) => f.exposure_amount)).toEqual([null, null]);
    expect(result.deal_figures).toMatchObject({ room_block_room_nights: 2900, group_rate: 149, cancellation_tiers: [] });
    expect(result.reading).toMatchObject({
      ok: true,
      tokens: { input: 400, output: 40 },
      reask: { asked_for: ["cancellation.damages_basis"], error: "Connection error." },
    });
  });
});
