import { beforeEach, describe, expect, it, vi } from "vitest";
import { EXPOSURE_TERM_KEYS, MUST_RAISE_TERM_KEYS } from "@/lib/exposures/figures";
import { EXPOSURE_CATALOG, MUST_RAISE_CATALOG, reviewContract, TIER_CATALOG } from "@/lib/review";
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
    messages = { create, stream: (...args: unknown[]) => ({ finalMessage: () => create(...args) }) };
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
  vi.stubEnv("EXPOSURES", "on");
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

    expect(review.findings.length).toBeGreaterThanOrEqual(2);
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

describe("what the app adds when the judging call leaves a clause out", () => {
  const COMMISSION_LINE = "We will pay to ConferenceDirect a commission of 8% of the Group Room Rate on all paid and occupied rooms.";
  const TEXT = [CONTRACT, COMMISSION_LINE].join("\n");

  // The judging call rates four clauses short and writes a finding for one of them.
  const judged = toolResponse("record_analysis", {
    clause_review: ["attrition", "commission", "rate_parity", "cutoff_date"].map((clause_type) => ({ clause_type, verdict: "falls_short", basis: "Short." })),
    findings: [{ ...finding("cutoff_date"), quoted_text: "Run of House: $149.00 per night." }],
    flagged_findings: [],
    document_notes: [],
    other_findings: [],
  });
  const read = toolResponse("record_contract_terms", {
    terms: [
      term("deal.room_block_room_nights", 2900, "Total Room Nights: 2,900"),
      term("deal.group_rate_usd", 149, "Run of House: $149.00 per night."),
      term("attrition.minimum_room_nights", 2280, "You agree that you will use at least 2,280 room nights."),
      term("attrition.liability_rate", 80, "times eighty percent (80%)"),
      term("commission.commission_pct", 8, COMMISSION_LINE),
    ],
  });

  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    create.mockImplementation(async (params: ModelRequest) => (answerName(params) === "record_analysis" ? judged : read));
  });

  const review = () => run({ document: { kind: "text", text: TEXT }, parts: [{ part: "document", text: TEXT }] });

  it("asks the reader for the commission rate beside the exposure terms", async () => {
    await review();
    expect(answerSchema(readingRequest()).properties.terms.items.properties.term_key.enum).toContain("commission.commission_pct");
  });

  it("raises the commission and the attrition floor itself, and the attrition finding carries its exposure", async () => {
    const result = await review();
    const byClause = (clause: string) => result.findings.filter((f) => f.clause_type === clause);

    expect(byClause("commission")).toHaveLength(1);
    expect(byClause("commission")[0]).toMatchObject({
      category: "business",
      headline: "Commission is 8%, below the 10% standard",
      proposed_language: COMMISSION_LINE.replace("8%", "10%"),
    });
    expect(byClause("attrition")).toHaveLength(1);
    expect(byClause("attrition")[0]).toMatchObject({
      proposed_language: "You agree that you will use at least 2,030 room nights.",
      exposure_amount: 29800,
      exposure_formula: "(2280 - 2030) * $149 * 0.8",
    });
  });

  it("names in one note the clauses still left without a finding, and says nothing when none is", async () => {
    const result = await review();
    expect(result.document_notes).toEqual([
      {
        headline: "The review left 1 clause without a finding.",
        detail: "It judged this short of the standard and wrote nothing: rate parity. Read it yourself, or run the review again.",
      },
    ]);

    create.mockImplementation(async (params: ModelRequest) => (answerName(params) === "record_analysis" ? analysisResponse : termsResponse));
    expect((await run()).document_notes).toEqual([]);
  });
});

describe("with exposure math archived (EXPOSURES off)", () => {
  const COMMISSION_LINE = "We will pay to ConferenceDirect a commission of 8% of the Group Room Rate on all paid and occupied rooms.";
  const TEXT = [CONTRACT, COMMISSION_LINE].join("\n");
  const askedFor = (r: ModelRequest) => answerSchema(r).properties.terms.items.properties.term_key.enum;
  const readings = () => requests().filter((r) => answerName(r) === "record_contract_terms");

  // The judging call writes no finding for attrition or commission.
  const judged = toolResponse("record_analysis", {
    clause_review: ["attrition", "commission"].map((clause_type) => ({ clause_type, verdict: "falls_short", basis: "Short." })),
    findings: [],
    flagged_findings: [],
    document_notes: [],
    other_findings: [],
  });
  const read = toolResponse("record_contract_terms", {
    terms: [
      term("deal.room_block_room_nights", 2900, "Total Room Nights: 2,900"),
      term("attrition.minimum_room_nights", 2280, "You agree that you will use at least 2,280 room nights."),
      term("commission.commission_pct", 8, COMMISSION_LINE),
    ],
  });

  beforeEach(() => {
    vi.stubEnv("EXPOSURES", "");
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("asks the reader for the five numbers the app raises findings from, and nothing else", async () => {
    await run();

    expect(askedFor(readingRequest())).toEqual(MUST_RAISE_CATALOG.terms.map((t) => t.key));
    expect([...askedFor(readingRequest())].sort()).toEqual([...MUST_RAISE_TERM_KEYS].sort());
    expect(MUST_RAISE_TERM_KEYS).toHaveLength(5);
    expect(askedFor(readingRequest())).not.toContain("deal.group_rate_usd");
    expect(askedFor(readingRequest())).not.toContain("cancellation.top_tier_pct");
  });

  it("puts no figure on any finding", async () => {
    const review = await run();

    expect(review.findings.length).toBeGreaterThanOrEqual(2);
    for (const f of review.findings) {
      expect(f.exposure_amount).toBeNull();
      expect(f.exposure_basis).toBeNull();
      expect(f.exposure_formula ?? null).toBeNull();
    }
  });

  it("still raises the commission and the attrition floor itself, with the number corrected and no dollar figure", async () => {
    create.mockImplementation(async (params: ModelRequest) => (answerName(params) === "record_analysis" ? judged : read));
    const result = await run({ document: { kind: "text", text: TEXT }, parts: [{ part: "document", text: TEXT }] });
    const byClause = (clause: string) => result.findings.filter((f) => f.clause_type === clause);

    expect(byClause("commission")[0]).toMatchObject({
      headline: "Commission is 8%, below the 10% standard",
      proposed_language: COMMISSION_LINE.replace("8%", "10%"),
      exposure_amount: null,
    });
    expect(byClause("attrition")[0]).toMatchObject({
      proposed_language: "You agree that you will use at least 2,030 room nights.",
      exposure_amount: null,
    });
  });

  it("never asks the reader a second time, even when a wider catalog leaves a cancellation answer out", async () => {
    const TIER_QUOTE = "the Minimum Number of Room Nights, times the Group Room Rate, times 90%";
    const CANCEL = [CONTRACT, `90 Days or Less: ${TIER_QUOTE}`].join("\n");
    create.mockImplementation(async (params: ModelRequest) =>
      answerName(params) === "record_analysis"
        ? analysisResponse
        : toolResponse("record_contract_terms", {
            terms: [
              term("cancellation.top_tier_pct", 90, TIER_QUOTE),
              term("cancellation.damages_room_nights", "minimum_commitment", TIER_QUOTE),
            ],
          })
    );

    const result = await run({ document: { kind: "text", text: CANCEL }, parts: [{ part: "document", text: CANCEL }], catalog: HOTEL_TERM_CATALOG });

    expect(readings()).toHaveLength(1);
    expect(result.reading).toMatchObject({ ok: true, reask: null });
  });

  it("reads the whole catalog when given it, as a stored-terms review does", async () => {
    await run({ catalog: HOTEL_TERM_CATALOG });
    expect(askedFor(readingRequest())).toHaveLength(HOTEL_TERM_CATALOG.terms.length);
  });
});

describe("asking the judging call again for a clause it left without a finding", () => {
  // The first pass rates two clauses short and writes a finding for one.
  const judged = toolResponse("record_analysis", {
    clause_review: [
      { clause_type: "cutoff_date", verdict: "falls_short", basis: "The cutoff is 45 days out." },
      { clause_type: "rate_parity", verdict: "missing", basis: "The contract is silent on lower public rates." },
    ],
    findings: [{ ...finding("cutoff_date"), quoted_text: "Run of House: $149.00 per night." }],
    flagged_findings: [],
    document_notes: [],
    other_findings: [],
  });

  const second = (input: Record<string, unknown>) =>
    toolResponse(
      "record_analysis",
      { clause_review: [{ clause_type: "rate_parity", verdict: "missing", basis: "Silent." }], flagged_findings: [], document_notes: [], other_findings: [], ...input },
      { input_tokens: 700, output_tokens: 70 }
    );

  const isSecondAsk = (request: ModelRequest) => JSON.stringify(request).includes("EARLIER PASS");
  const secondAsks = () => requests().filter((r) => answerName(r) === "record_analysis" && isSecondAsk(r));

  /** The judging call answers `judged` first, then `again` when asked a second time. */
  const answering = (again: () => unknown) =>
    create.mockImplementation(async (params: ModelRequest) => {
      if (answerName(params) !== "record_analysis") return termsResponse;
      return isSecondAsk(params) ? again() : judged;
    });

  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    answering(() => second({ findings: [{ ...finding("rate_parity"), is_missing_clause: true, quoted_text: null }] }));
  });

  it("asks with a library cut down to the skipped clause, and says what the first pass judged", async () => {
    await run();

    expect(secondAsks()).toHaveLength(1);
    const request = JSON.stringify(secondAsks()[0]);
    expect(request).toContain('\\"clause_type\\": \\"rate_parity\\"');
    expect(request).not.toContain('\\"clause_type\\": \\"cutoff_date\\"');
    expect(request).toContain("- rate_parity: missing. The contract is silent on lower public rates.");
  });

  it("adds the findings that come back, and drops the note", async () => {
    const result = await run();

    expect(result.findings.filter((f) => f.clause_type === "rate_parity")).toHaveLength(1);
    expect(result.document_notes).toEqual([]);
    expect(result.follow_up).toEqual({
      asked_for: ["rate_parity"],
      findings_added: 1,
      tokens: { input: 700, output: 70, cache_read: 0, cache_creation: 0 },
    });
  });

  it("keeps the first pass's usage and verdicts as they were", async () => {
    const result = await run();
    expect(result).toMatchObject({ input_tokens: 100, output_tokens: 10 });
    expect(result.clause_review.find((entry) => entry.clause_type === "rate_parity")?.basis).toBe("The contract is silent on lower public rates.");
  });

  it("doesn't ask when every clause judged short has a finding", async () => {
    create.mockImplementation(async (params: ModelRequest) => (answerName(params) === "record_analysis" ? analysisResponse : termsResponse));
    const result = await run();
    expect(create).toHaveBeenCalledTimes(2);
    expect(result.follow_up).toBeNull();
  });

  it("keeps only findings on the clauses it asked about, and none of the second pass's other findings or notes", async () => {
    answering(() =>
      second({
        findings: [{ ...finding("rate_parity"), is_missing_clause: true, quoted_text: null }, finding("attrition")],
        other_findings: [{ headline: "Parking is extra.", quoted_text: "Run of House: $149.00 per night.", finding_text: "Not in the library." }],
        document_notes: [{ headline: "Two dates disagree.", detail: "" }],
      })
    );
    const result = await run();

    // The app raises attrition itself from the reading. The second pass's own attrition finding is dropped.
    expect(result.findings.filter((f) => f.clause_type === "rate_parity")).toHaveLength(1);
    expect(result.findings.filter((f) => f.clause_type === "attrition" && f.headline === "Too high.")).toEqual([]);
    expect(result.findings.filter((f) => f.category === "other")).toEqual([]);
    expect(result.document_notes).toEqual([]);
    expect(result.follow_up?.findings_added).toBe(1);
  });

  it("leaves the review complete and the note in place when the second ask fails", async () => {
    answering(() => {
      throw new Error("overloaded");
    });
    const result = await run();

    expect(result.findings.some((f) => f.clause_type === "cutoff_date")).toBe(true);
    expect(result.findings.some((f) => f.clause_type === "rate_parity")).toBe(false);
    expect(result.document_notes).toEqual([expect.objectContaining({ headline: "The review left 1 clause without a finding." })]);
    expect(result.follow_up).toEqual({ asked_for: ["rate_parity"], findings_added: 0, error: "overloaded" });
  });

  it("keeps the note when the second ask writes nothing for the clause", async () => {
    answering(() => second({ findings: [] }));
    const result = await run();
    expect(result.document_notes).toEqual([expect.objectContaining({ headline: "The review left 1 clause without a finding." })]);
    expect(result.follow_up).toMatchObject({ asked_for: ["rate_parity"], findings_added: 0 });
  });

  it("doesn't ask with under 90 seconds left", async () => {
    const result = await run({ deadline: Date.now() + 60_000 });

    expect(secondAsks()).toHaveLength(0);
    expect(result.document_notes).toEqual([expect.objectContaining({ headline: "The review left 1 clause without a finding." })]);
    expect(result.follow_up).toEqual({ asked_for: ["rate_parity"], findings_added: 0, error: "Too little time was left to ask again." });
  });
});
