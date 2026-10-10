import { readFile } from "node:fs/promises";
import path from "node:path";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { MODEL_CALL_BUDGET_MS, STALE_ANALYSIS_MINUTES } from "@/lib/analysis-status";
import { HOTEL_TERM_CATALOG } from "@/lib/terms/catalog";
import { EXPOSURE_CATALOG, MUST_RAISE_CATALOG } from "@/lib/review";
import { answerName, answerSchema, type ModelRequest } from "../helpers/model-request";

/**
 * processAnalysis with term extraction switched off, on, failing, and gated.
 *
 * Supabase and the model are faked. What is under test is the wiring: the
 * switch, the AI-use gate running first, and a failed extraction never failing
 * the review it runs alongside.
 */

const { create, scanForAiUseTerms, sets } = vi.hoisted(() => ({
  create: vi.fn(),
  scanForAiUseTerms: vi.fn(() => [] as { term: string }[]),
  sets: { asked: [] as string[], unusable: [] as string[], unreadable: false },
}));

vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = { create, stream: (...args: unknown[]) => ({ finalMessage: () => create(...args) }) };
  },
}));
vi.mock("@/lib/ai-use-scan", () => ({ scanForAiUseTerms, scanForAdjacentTerms: () => [] }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(async () => {}) }));
vi.mock("@/lib/get-positioned-lines", () => ({ getPositionedLines: vi.fn(async () => []) }));
vi.mock("@/lib/standards/load", async () => {
  const { STANDARDS_LIBRARY, STANDARDS_LIBRARY_VERSION } = await import("@/lib/standards/v1");
  return {
    // Stands in for the loader: the set asked for is used unless a test says it can't be.
    loadStandardsLibrary: async (setKey = "independent") => {
      sets.asked.push(setKey);
      if (sets.unreadable) throw new Error("The standards library couldn't be read, so nothing was reviewed (JWT issued at future). Use Retry to run it again.");
      const refused = sets.unusable.includes(setKey);
      return {
        entries: STANDARDS_LIBRARY,
        version: STANDARDS_LIBRARY_VERSION,
        source: "bundled_fallback",
        hash: "test",
        set: refused ? "independent" : setKey,
        requestedSet: setKey,
        setNote: refused ? "Hyatt's standards are switched off, so this review used Independent." : undefined,
      };
    },
  };
});

interface Write {
  table: string;
  op: "update" | "insert" | "delete";
  payload?: unknown;
}

const db = {
  writes: [] as Write[],
  termsInsertError: null as string | null,
  bytes: new Uint8Array(),
  row: {} as Record<string, unknown>,
  thread: null as Record<string, unknown> | null,
  threadError: null as string | null,
  /** Every path asked of storage, and the error storage answers with when one is set. */
  downloads: [] as string[],
  downloadError: null as string | null,
};

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      const query = {
        select: () => query,
        eq: () => query,
        single: async () => ({
          data: {
            id: "analysis-1",
            storage_path: "a.pdf",
            associate_id: "associate-1",
            source_format: "docx",
            intake_route: "docx_native",
            original_storage_path: "a.docx",
            ai_clause_acknowledged_at: null,
            ...db.row,
          },
          error: null,
        }),
        maybeSingle: async () =>
          table === "negotiation_threads" && db.threadError
            ? { data: null, error: { message: db.threadError } }
            : { data: table === "negotiation_threads" ? db.thread : null, error: null },
        update: (payload: unknown) => {
          db.writes.push({ table, op: "update", payload });
          return { eq: async () => ({ error: null }) };
        },
        delete: () => {
          db.writes.push({ table, op: "delete" });
          return { eq: async () => ({ error: null }) };
        },
        insert: (payload: unknown) => {
          db.writes.push({ table, op: "insert", payload });
          const error = table === "contract_terms" && db.termsInsertError ? { message: db.termsInsertError } : null;
          const result = { data: [], error };
          return Object.assign(Promise.resolve(result), { select: async () => result });
        },
      };
      return query;
    },
    storage: {
      from: () => ({
        download: async (path: string) => {
          db.downloads.push(path);
          return db.downloadError ? { data: null, error: { message: db.downloadError } } : { data: new Blob([db.bytes]), error: null };
        },
      }),
    },
  }),
}));

const { processAnalysis } = await import("@/lib/analysis-pipeline");
const { getPositionedLines } = await import("@/lib/get-positioned-lines");

const toolResponse = (name: string, input: unknown) => ({
  content: [{ type: "tool_use", id: "toolu_test", name, input }],
  stop_reason: "tool_use",
  usage: { input_tokens: 100, output_tokens: 10 },
});

const analysisInput = { clause_review: [{ clause_type: "attrition", verdict: "meets", basis: "" }], findings: [], document_notes: [] };
const analysisResponse = toolResponse("record_analysis", analysisInput);
const termsResponse = toolResponse("record_contract_terms", {
  terms: [{ term_key: "deal.group_rate_usd", value: 289, quoted_text: "a group rate of $289.00 per room", confidence: "high" }],
});

const toolCalled = () => create.mock.calls.map((c) => answerName(c[0]));
const updatesTo = (table: string) => db.writes.filter((w) => w.table === table && w.op === "update").map((w) => w.payload as Record<string, unknown>);
const termWrites = () => db.writes.filter((w) => w.table === "contract_terms");

beforeAll(async () => {
  db.bytes = new Uint8Array(await readFile(path.join("data", "sample-contracts", "eval", "eval-01-harborview.docx")));
});

beforeEach(() => {
  create.mockReset();
  scanForAiUseTerms.mockReturnValue([]);
  db.writes = [];
  db.termsInsertError = null;
  db.row = {};
  db.thread = null;
  db.threadError = null;
  db.downloads = [];
  db.downloadError = null;
  sets.asked = [];
  sets.unusable = [];
  sets.unreadable = false;
  vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
  vi.stubEnv("TERM_EXTRACTION", "");
  vi.stubEnv("EXPOSURES", "on");
  create.mockImplementation(async (params: ModelRequest) =>
    answerName(params) === "record_analysis" ? analysisResponse : termsResponse
  );
});

describe("a contract stopped at the AI-use check", () => {
  // A retry skipped the check, since the decision was already recorded, and
  // would have sent a contract the associate declined straight to the model.
  it("never reaches the model, even if it is run again", async () => {
    db.row = {
      ai_clause_acknowledged_at: "2026-09-26T15:00:00.000Z",
      ai_clause_scan_result: { matches: [{ term: "artificial intelligence" }], decision: "abort" },
    };
    vi.spyOn(console, "warn").mockImplementation(() => {});

    await processAnalysis("analysis-1");

    expect(create).not.toHaveBeenCalled();
    expect(updatesTo("analyses")).toEqual([
      { status: "failed", error: expect.stringMatching(/chose not to proceed at the AI-use check/) },
    ]);
  });
});

describe("term extraction in processAnalysis", () => {
  it("is off by default: the reading call asks only for the exposure terms, and no term row is stored", async () => {
    await processAnalysis("analysis-1");

    expect(toolCalled().sort()).toEqual(["record_analysis", "record_contract_terms"]);
    const reading = create.mock.calls.map((c) => c[0]).find((body) => answerName(body) === "record_contract_terms");
    expect(answerSchema(reading).properties.terms.items.properties.term_key.enum).toEqual(EXPOSURE_CATALOG.terms.map((t) => t.key));
    expect(termWrites()).toEqual([]);

    const complete = updatesTo("analyses").find((u) => u.status === "complete");
    expect(complete?.token_usage).toMatchObject({ reading: { input: 100, output: 10 } });
  });

  it("keeps the reading with the review while off: the figures, the terms behind them, and what was left out", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await processAnalysis("analysis-1");

    const record = updatesTo("analyses").find((u) => "term_extraction" in u)?.term_extraction as Record<string, unknown>;
    expect(record).toMatchObject({
      status: "complete",
      asked_for: "exposure_terms",
      reask: null,
      exposures: {
        figures: { group_rate: 289, currency: "$", room_block_room_nights: null, cancellation_tiers: [] },
        terms: [{ term_key: "deal.group_rate_usd", value: 289, quoted_text: "a group rate of $289.00 per room", verification: "verified" }],
      },
    });
    const exposures = record.exposures as { not_stated: string[]; notes: { term_key: string }[] };
    expect(exposures.not_stated).toContain("cancellation.top_tier_pct");
    expect(exposures.notes.map((n) => n.term_key)).toEqual(["cancellation.top_tier_pct", "cancellation.damages_basis"]);
    expect(termWrites()).toEqual([]);
  });

  it("records a failed reading while off, so missing exposures are explained", async () => {
    create.mockImplementation(async (params: ModelRequest) => {
      if (answerName(params) === "record_contract_terms") throw new Error("Connection error.");
      return analysisResponse;
    });
    vi.spyOn(console, "error").mockImplementation(() => {});

    await processAnalysis("analysis-1");

    expect(updatesTo("analyses").some((u) => u.status === "complete")).toBe(true);
    expect(updatesTo("analyses").find((u) => "term_extraction" in u)?.term_extraction).toMatchObject({
      status: "failed",
      error: "Connection error.",
    });
  });

  it("saves the model's notes on the document, and saves none when it wrote none", async () => {
    create.mockImplementation(async (params: ModelRequest) =>
      answerName(params) === "record_analysis"
        ? toolResponse("record_analysis", {
            ...analysisInput,
            document_notes: [{ headline: "The meeting dates say 2010, and the room block says 2015.", detail: "" }],
          })
        : termsResponse
    );
    await processAnalysis("analysis-1");
    const completed = updatesTo("analyses").find((u) => u.status === "complete");
    expect(completed?.document_notes).toEqual([
      { headline: "The meeting dates say 2010, and the room block says 2015.", detail: "" },
    ]);

    db.writes = [];
    create.mockImplementation(async () => analysisResponse);
    await processAnalysis("analysis-1");
    expect(updatesTo("analyses").find((u) => u.status === "complete")?.document_notes).toBeNull();
  });

  it("saves the second ask with the review's usage, so its cost is counted", async () => {
    const short = { ...analysisInput, clause_review: [{ clause_type: "rate_parity", verdict: "missing", basis: "Silent." }] };
    create.mockImplementation(async (params: ModelRequest) =>
      answerName(params) === "record_analysis" ? toolResponse("record_analysis", short) : termsResponse
    );
    await processAnalysis("analysis-1");

    const complete = updatesTo("analyses").find((u) => u.status === "complete");
    expect(complete?.token_usage).toMatchObject({
      follow_up: { asked_for: ["rate_parity"], findings_added: 0, tokens: { input: 100, output: 10 } },
    });

    db.writes = [];
    create.mockImplementation(async (params: ModelRequest) => (answerName(params) === "record_analysis" ? analysisResponse : termsResponse));
    await processAnalysis("analysis-1");
    expect(updatesTo("analyses").find((u) => u.status === "complete")?.token_usage).toMatchObject({ follow_up: null });
  });

  it("fails the review, without calling the model, when the standards library can't be read", async () => {
    sets.unreadable = true;
    await processAnalysis("analysis-1");

    expect(create).not.toHaveBeenCalled();
    expect(updatesTo("analyses").find((u) => u.status === "failed")?.error).toMatch(/standards library couldn't be read, so nothing was reviewed/);
    expect(updatesTo("analyses").some((u) => u.status === "complete")).toBe(false);
  });

  it("gives the review call the model budget as its time limit", async () => {
    await processAnalysis("analysis-1");

    const options = create.mock.calls.find(([body]) => answerName(body) === "record_analysis")?.[1];
    expect(options.maxRetries).toBe(0);
    expect(options.timeout).toBeGreaterThan(MODEL_CALL_BUDGET_MS - 60_000);
    expect(options.timeout).toBeLessThanOrEqual(MODEL_CALL_BUDGET_MS);
  });

  it("fits the model budget inside every analysis route's ceiling, with room to save", async () => {
    // A serverless host stops the route at maxDuration, mid-save if the
    // budget runs up against it.
    for (const route of ["route.ts", "[id]/retry/route.ts", "[id]/ai-clause-decision/route.ts"]) {
      const source = await readFile(path.join("app", "api", "analyses", route), "utf8");
      const seconds = Number(source.match(/export const maxDuration = (\d+);/)?.[1]);
      expect(seconds * 1000, route).toBeGreaterThanOrEqual(MODEL_CALL_BUDGET_MS + 60_000);
    }
    expect(STALE_ANALYSIS_MINUTES * 60_000).toBeGreaterThan(MODEL_CALL_BUDGET_MS + 60_000);
  });

  it("runs alongside the review when switched on, and stores a row per catalog term", async () => {
    vi.stubEnv("TERM_EXTRACTION", "on");
    await processAnalysis("analysis-1");

    expect(toolCalled().sort()).toEqual(["record_analysis", "record_contract_terms"]);
    const reading = create.mock.calls.map((c) => c[0]).find((body) => answerName(body) === "record_contract_terms");
    expect(answerSchema(reading).properties.terms.items.properties.term_key.enum).toHaveLength(HOTEL_TERM_CATALOG.terms.length);
    const [cleared, inserted] = termWrites();
    expect(cleared.op).toBe("delete");
    expect(inserted.payload).toHaveLength(HOTEL_TERM_CATALOG.terms.length);
    expect(updatesTo("analyses").find((u) => "term_extraction" in u)?.term_extraction).toMatchObject({
      status: "complete",
      stated: 1,
      verification: { verified: 1 },
    });
  });

  it("never fails the review when extraction fails", async () => {
    vi.stubEnv("TERM_EXTRACTION", "on");
    create.mockImplementation(async (params: ModelRequest) => {
      if (answerName(params) === "record_contract_terms") throw new Error("Connection error.");
      return analysisResponse;
    });
    vi.spyOn(console, "error").mockImplementation(() => {});

    await processAnalysis("analysis-1");

    expect(updatesTo("analyses").some((u) => u.status === "complete")).toBe(true);
    expect(updatesTo("analyses").some((u) => u.status === "failed")).toBe(false);
    expect(termWrites()).toEqual([]);
    expect(updatesTo("analyses").find((u) => "term_extraction" in u)?.term_extraction).toMatchObject({
      status: "failed",
      error: "Connection error.",
    });
  });

  it("records terms that could not be saved as a failed pass", async () => {
    vi.stubEnv("TERM_EXTRACTION", "on");
    db.termsInsertError = 'relation "contract_terms" does not exist';
    await processAnalysis("analysis-1");

    expect(updatesTo("analyses").find((u) => "term_extraction" in u)?.term_extraction).toMatchObject({
      status: "failed",
      error: 'Terms were extracted but not saved: relation "contract_terms" does not exist',
    });
  });

  it("sends nothing to the model while the AI-use gate is holding the contract", async () => {
    vi.stubEnv("TERM_EXTRACTION", "on");
    scanForAiUseTerms.mockReturnValue([{ term: "artificial intelligence" }]);

    await processAnalysis("analysis-1");

    expect(create).not.toHaveBeenCalled();
    expect(termWrites()).toEqual([]);
  });
});

describe("the reading kept with a review while exposure math is archived", () => {
  it("asks for the safety-net terms, and stores the figures read with no exposure record", async () => {
    vi.stubEnv("EXPOSURES", "");
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await processAnalysis("analysis-1");

    const reading = create.mock.calls.map((c) => c[0]).find((body) => answerName(body) === "record_contract_terms");
    expect(answerSchema(reading).properties.terms.items.properties.term_key.enum).toEqual(MUST_RAISE_CATALOG.terms.map((t) => t.key));

    const record = updatesTo("analyses").find((u) => "term_extraction" in u)?.term_extraction as Record<string, unknown>;
    expect(record).toMatchObject({ status: "complete", asked_for: "must_raise_terms", figures: { commission_pct: null } });
    expect(record).not.toHaveProperty("exposures");

    const saved = db.writes.filter((w) => w.table === "findings" && w.op === "insert").flatMap((w) => w.payload as { exposure_amount: unknown }[]);
    for (const row of saved) expect(row.exposure_amount).toBeNull();
  });
});

describe("the standards set a review reads", () => {
  const completed = () => updatesTo("analyses").find((u) => u.status === "complete");

  it("reads Independent for a negotiation with no set, and records it", async () => {
    db.row = { thread_id: "thread-1" };
    db.thread = { standards_set: null };
    await processAnalysis("analysis-1");

    expect(sets.asked).toEqual(["independent"]);
    expect(completed()).toMatchObject({ standards_set: "independent", standards_set_requested: null, standards_set_note: null });
  });

  it("reads the set its negotiation names, on every round", async () => {
    db.row = { thread_id: "thread-1" };
    db.thread = { standards_set: "hilton" };
    await processAnalysis("analysis-1");
    await processAnalysis("analysis-2");

    expect(sets.asked).toEqual(["hilton", "hilton"]);
    expect(completed()).toMatchObject({ standards_set: "hilton", standards_set_requested: null, standards_set_note: null });
  });

  it("records the set asked for and why, when the review had to use another", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    db.row = { thread_id: "thread-1" };
    db.thread = { standards_set: "hyatt" };
    sets.unusable = ["hyatt"];
    await processAnalysis("analysis-1");

    expect(completed()).toMatchObject({
      standards_set: "independent",
      standards_set_requested: "hyatt",
      standards_set_note: "Hyatt's standards are switched off, so this review used Independent.",
    });
  });

  it("fails before the model is called when the negotiation's set can't be read", async () => {
    db.row = { thread_id: "thread-1" };
    db.threadError = 'column negotiation_threads.standards_set does not exist';
    await processAnalysis("analysis-1");

    expect(create).not.toHaveBeenCalled();
    expect(updatesTo("analyses").find((u) => u.status === "failed")?.error).toMatch(/migration 015 has not been applied/);
  });
});

describe("which file a review reads", () => {
  it("reads the Word file alone on the Word route, and never the converted PDF", async () => {
    vi.mocked(getPositionedLines).mockClear();
    await processAnalysis("analysis-1");

    expect(db.downloads).toEqual(["a.docx"]);
    // The page-number step reads the PDF's lines, so it can't have run.
    expect(getPositionedLines).not.toHaveBeenCalled();
    expect(updatesTo("findings")).toEqual([]);
    expect(updatesTo("analyses").find((u) => u.status === "complete")).toMatchObject({ accepted_view_text: expect.stringContaining("Harborview") });
  });

  it("fails before the model is called when the Word file can't be read", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    db.downloadError = "gateway timeout";

    await processAnalysis("analysis-1");

    expect(create).not.toHaveBeenCalled();
    expect(db.downloads).toEqual(["a.docx", "a.docx", "a.docx"]);
    expect(updatesTo("analyses").at(-1)).toMatchObject({
      status: "failed",
      error: "The Word file couldn't be read, so nothing was reviewed (gateway timeout). Use Retry to run it again.",
    });
  });

  it("fails with the reader's reason when the Word file arrives and isn't one", async () => {
    const real = db.bytes;
    db.bytes = new Uint8Array([1, 2, 3]);
    try {
      await processAnalysis("analysis-1");
    } finally {
      db.bytes = real;
    }

    expect(create).not.toHaveBeenCalled();
    expect(db.downloads).toEqual(["a.docx"]);
    expect(updatesTo("analyses").at(-1)).toMatchObject({ status: "failed", error: expect.stringMatching(/^The Word file couldn't be read, so nothing was reviewed \(/) });
  });

  it("reads the stored PDF and its lines for a review off the Word route", async () => {
    vi.mocked(getPositionedLines).mockClear();
    db.row = { source_format: "pdf", intake_route: "pdf", original_storage_path: null };

    await processAnalysis("analysis-1");

    expect(db.downloads).toEqual(["a.pdf"]);
    expect(getPositionedLines).toHaveBeenCalled();
    expect(updatesTo("analyses").find((u) => u.status === "complete")).toMatchObject({ accepted_view_text: null });
  });
});
