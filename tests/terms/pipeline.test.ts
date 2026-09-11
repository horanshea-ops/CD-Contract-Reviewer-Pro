import { readFile } from "node:fs/promises";
import path from "node:path";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { HOTEL_TERM_CATALOG } from "@/lib/terms/catalog";

/**
 * processAnalysis with term extraction switched off, on, failing, and gated.
 *
 * Supabase and the model are faked. What is under test is the wiring: the
 * switch, the AI-use gate running first, and a failed extraction never failing
 * the review it runs alongside.
 */

const { create, scanForAiUseTerms } = vi.hoisted(() => ({
  create: vi.fn(),
  scanForAiUseTerms: vi.fn(() => [] as { term: string }[]),
}));

vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = { create };
  },
}));
vi.mock("@/lib/ai-use-scan", () => ({ scanForAiUseTerms, scanForAdjacentTerms: () => [] }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(async () => {}) }));
vi.mock("@/lib/get-positioned-lines", () => ({ getPositionedLines: vi.fn(async () => []) }));
vi.mock("@/lib/standards/load", async () => {
  const { STANDARDS_LIBRARY, STANDARDS_LIBRARY_VERSION } = await import("@/lib/standards/v1");
  return {
    loadStandardsLibrary: async () => ({
      entries: STANDARDS_LIBRARY,
      version: STANDARDS_LIBRARY_VERSION,
      source: "bundled_fallback",
      hash: "test",
    }),
  };
});

interface Write {
  table: string;
  op: "update" | "insert" | "delete";
  payload?: unknown;
}

const db = { writes: [] as Write[], termsInsertError: null as string | null, bytes: new Uint8Array() };

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
          },
          error: null,
        }),
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
    storage: { from: () => ({ download: async () => ({ data: new Blob([db.bytes]), error: null }) }) },
  }),
}));

const { processAnalysis } = await import("@/lib/analysis-pipeline");

const toolResponse = (name: string, input: unknown) => ({
  content: [{ type: "tool_use", id: "toolu_test", name, input }],
  stop_reason: "tool_use",
  usage: { input_tokens: 100, output_tokens: 10 },
});

const analysisResponse = toolResponse("record_analysis", { findings: [], clauses_checked: ["attrition"], document_notes: "" });
const termsResponse = toolResponse("record_contract_terms", {
  terms: [{ term_key: "deal.group_rate_usd", value: 289, quoted_text: "a group rate of $289.00 per room", confidence: "high" }],
});

const toolCalled = () => create.mock.calls.map((c) => c[0].tool_choice.name);
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
  vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
  vi.stubEnv("TERM_EXTRACTION", "");
  create.mockImplementation(async (params: { tool_choice: { name: string } }) =>
    params.tool_choice.name === "record_analysis" ? analysisResponse : termsResponse
  );
});

describe("term extraction in processAnalysis", () => {
  it("is off by default: one model call, no term writes", async () => {
    await processAnalysis("analysis-1");

    expect(toolCalled()).toEqual(["record_analysis"]);
    expect(termWrites()).toEqual([]);
    expect(updatesTo("analyses").some((u) => "term_extraction" in u)).toBe(false);
    expect(updatesTo("analyses").some((u) => u.status === "complete")).toBe(true);
  });

  it("runs alongside the review when switched on, and stores a row per catalog term", async () => {
    vi.stubEnv("TERM_EXTRACTION", "on");
    await processAnalysis("analysis-1");

    expect(toolCalled().sort()).toEqual(["record_analysis", "record_contract_terms"]);
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
    create.mockImplementation(async (params: { tool_choice: { name: string } }) => {
      if (params.tool_choice.name === "record_contract_terms") throw new Error("Connection error.");
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
