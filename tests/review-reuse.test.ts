import { readFile } from "node:fs/promises";
import path from "node:path";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The same file uploaded again copies the earlier review and calls no model.
 *
 * Supabase is an in-memory fake that filters and writes real rows, so a copy
 * can be read back. The model is faked and must not be called on a match.
 */

const { create } = vi.hoisted(() => ({ create: vi.fn() }));

vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = { create };
  },
}));
vi.mock("@/lib/ai-use-scan", () => ({ scanForAiUseTerms: () => [], scanForAdjacentTerms: () => [] }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(async () => {}) }));
vi.mock("@/lib/get-positioned-lines", () => ({ getPositionedLines: vi.fn(async () => []) }));

const library = { hash: "library-1" };
vi.mock("@/lib/standards/load", async () => {
  const { STANDARDS_LIBRARY, STANDARDS_LIBRARY_VERSION } = await import("@/lib/standards/v1");
  return {
    loadStandardsLibrary: async () => ({
      entries: STANDARDS_LIBRARY,
      version: STANDARDS_LIBRARY_VERSION,
      source: "database",
      hash: library.hash,
    }),
  };
});

type Row = Record<string, unknown>;
const db = { tables: {} as Record<string, Row[]>, bytes: new Uint8Array() };

function from(table: string) {
  const rows = () => (db.tables[table] ??= []);
  const filters: ((row: Row) => boolean)[] = [];
  let action: { op: "select" } | { op: "update"; patch: Row } | { op: "delete" } = { op: "select" };
  let sort: { column: string; ascending: boolean } | null = null;
  let cap = Infinity;

  const run = () => {
    const matched = rows().filter((row) => filters.every((keep) => keep(row)));
    if (action.op === "update") for (const row of matched) Object.assign(row, action.patch);
    if (action.op === "delete") db.tables[table] = rows().filter((row) => !matched.includes(row));
    const sorted = sort
      ? [...matched].sort((a, b) => String(a[sort!.column]).localeCompare(String(b[sort!.column])) * (sort!.ascending ? 1 : -1))
      : matched;
    return { data: sorted.slice(0, cap), error: null };
  };

  const query = {
    select: () => query,
    eq: (column: string, value: unknown) => (filters.push((row) => row[column] === value), query),
    neq: (column: string, value: unknown) => (filters.push((row) => row[column] !== value), query),
    in: (column: string, values: unknown[]) => (filters.push((row) => values.includes(row[column])), query),
    order: (column: string, { ascending }: { ascending: boolean }) => ((sort = { column, ascending }), query),
    limit: (n: number) => ((cap = n), query),
    update: (patch: Row) => ((action = { op: "update", patch }), query),
    delete: () => ((action = { op: "delete" }), query),
    insert: (payload: Row | Row[]) => {
      rows().push(...(Array.isArray(payload) ? payload : [payload]).map((row) => ({ ...row })));
      const result = { data: [], error: null };
      return Object.assign(Promise.resolve(result), { select: async () => result });
    },
    single: async () => {
      const [row] = run().data;
      return row ? { data: row, error: null } : { data: null, error: { message: "not found" } };
    },
    maybeSingle: async () => ({ data: run().data[0] ?? null, error: null }),
    then: (resolve: (value: { data: Row[]; error: null }) => unknown) => resolve(run()),
  };
  return query;
}

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from,
    storage: { from: () => ({ download: async () => ({ data: new Blob([db.bytes]), error: null }) }) },
  }),
}));

const { processAnalysis } = await import("@/lib/analysis-pipeline");
const { contentHash, promptHash } = await import("@/lib/review-reuse");

const finding = {
  clause_type: "attrition",
  is_missing_clause: false,
  severity: "high",
  location_section: null,
  quoted_text: "ninety percent (90%)",
  headline: "Too high.",
  finding_text: "Too high.",
  cd_standard: "80%.",
  proposed_language: "eighty percent (80%)",
  redline_note: null,
  model_confidence: "high",
};

const analysisResponse = {
  content: [
    {
      type: "tool_use",
      id: "toolu_test",
      name: "record_analysis",
      input: { clause_review: [{ clause_type: "attrition", verdict: "falls_short", basis: "" }], findings: [finding], document_notes: [] },
    },
  ],
  stop_reason: "tool_use",
  usage: { input_tokens: 100, output_tokens: 10 },
};

const upload = (id: string, extra: Row = {}): Row => ({
  id,
  storage_path: "a.pdf",
  associate_id: "associate-1",
  source_format: "docx",
  intake_route: "docx_native",
  original_storage_path: "a.docx",
  ai_clause_acknowledged_at: null,
  ai_clause_scan_result: null,
  status: "queued",
  review_kind: "full",
  ...extra,
});

const row = (id: string) => db.tables.analyses.find((r) => r.id === id)!;
const findingsOf = (id: string) => (db.tables.findings ?? []).filter((f) => f.analysis_id === id);

/** A first review of the sample contract, paid for and decided on. */
async function firstReview() {
  db.tables.analyses.push(upload("first"));
  await processAnalysis("first");
  const [original] = findingsOf("first");
  db.tables.finding_actions.push(
    { id: "action-1", finding_id: original.id, associate_id: "associate-1", action: "accept", edited_language: null, dismissal_reason: null, created_at: "2026-10-01T10:00:00Z" },
    { id: "action-2", finding_id: original.id, associate_id: "associate-1", action: "edit", edited_language: "eighty-five percent (85%)", dismissal_reason: null, created_at: "2026-10-01T11:00:00Z" }
  );
  create.mockClear();
  return original;
}

beforeAll(async () => {
  db.bytes = new Uint8Array(await readFile(path.join("data", "sample-contracts", "eval", "eval-01-harborview.docx")));
});

beforeEach(() => {
  create.mockReset();
  create.mockImplementation(async () => analysisResponse);
  db.tables = { analyses: [], findings: [], finding_actions: [], contract_terms: [] };
  library.hash = "library-1";
  vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
  vi.stubEnv("ANTHROPIC_MODEL", "claude-sonnet-5");
  vi.stubEnv("TERM_EXTRACTION", "");
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("the two hashes", () => {
  const text = (body: string) => ({ document: { kind: "text" as const, text: body } });

  it("give the same content the same hash, and any change to what the model would read a different one", () => {
    const base = contentHash(text("The rate is $149.00."));
    expect(contentHash(text("The rate is $149.00."))).toBe(base);
    expect(contentHash(text("The rate is $159.00."))).not.toBe(base);
    expect(contentHash({ ...text("The rate is $149.00."), contextNote: "One picture could not be read." })).not.toBe(base);
    expect(contentHash({ document: { kind: "pdf", pdfBase64: "AAAA" } })).not.toBe(contentHash({ document: { kind: "pdf", pdfBase64: "AAAB" } }));
  });

  it("tell one model from another", () => {
    expect(promptHash("claude-sonnet-5")).toBe(promptHash("claude-sonnet-5"));
    expect(promptHash("claude-sonnet-5")).not.toBe(promptHash("claude-sonnet-5-5"));
  });
});

describe("uploading the same file again", () => {
  it("stores both hashes with a full review", async () => {
    await firstReview();
    expect(row("first")).toMatchObject({
      status: "complete",
      review_kind: "full",
      content_hash: expect.stringMatching(/^[0-9a-f]{64}$/),
      prompt_hash: promptHash("claude-sonnet-5"),
    });
  });

  it("copies the earlier review with every decision, and calls no model", async () => {
    const original = await firstReview();
    db.tables.analyses.push(upload("second"));
    await processAnalysis("second");

    expect(create).not.toHaveBeenCalled();
    expect(row("second")).toMatchObject({
      status: "complete",
      review_kind: "copied",
      copied_from_analysis_id: "first",
      content_hash: row("first").content_hash,
      standards_hash: "library-1",
    });
    // The monthly allowance counts a review by its token_usage, and a copy has none.
    expect(row("second").token_usage).toBeUndefined();

    const [copy] = findingsOf("second");
    expect(findingsOf("second")).toHaveLength(1);
    expect(copy.id).not.toBe(original.id);
    expect(copy).toMatchObject({ clause_type: "attrition", quoted_text: "ninety percent (90%)", proposed_language: "eighty percent (80%)" });

    const decisions = db.tables.finding_actions.filter((a) => a.finding_id === copy.id);
    expect(decisions.map((d) => [d.action, d.edited_language, d.created_at])).toEqual([
      ["accept", null, "2026-10-01T10:00:00Z"],
      ["edit", "eighty-five percent (85%)", "2026-10-01T11:00:00Z"],
    ]);
    expect(findingsOf("first")).toHaveLength(1);
  });

  it("points a copy of a copy at the review the model wrote", async () => {
    await firstReview();
    db.tables.analyses.push(upload("second"), upload("third"));
    await processAnalysis("second");
    await processAnalysis("third");

    expect(create).not.toHaveBeenCalled();
    expect(row("third")).toMatchObject({ review_kind: "copied", copied_from_analysis_id: "first" });
  });

  it.each([
    ["another associate uploads it", () => db.tables.analyses.push(upload("second", { associate_id: "associate-2" }))],
    ["the standards library has changed", () => (db.tables.analyses.push(upload("second")), (library.hash = "library-2"))],
    ["the model has changed", () => (db.tables.analyses.push(upload("second")), vi.stubEnv("ANTHROPIC_MODEL", "claude-sonnet-5-5"))],
    ["the prompt has changed", () => (db.tables.analyses.push(upload("second")), (row("first").prompt_hash = "an-older-prompt"))],
    ["the file's content is different", () => (db.tables.analyses.push(upload("second")), (row("first").content_hash = "another-file"))],
    ["the earlier review did not complete", () => (db.tables.analyses.push(upload("second")), (row("first").status = "failed"))],
  ])("runs a full review when %s", async (_why, arrange) => {
    await firstReview();
    arrange();
    await processAnalysis("second");

    expect(create).toHaveBeenCalledTimes(1);
    expect(row("second")).toMatchObject({ status: "complete", review_kind: "full", copied_from_analysis_id: null });
  });

  it("runs a full review when asked for a fresh one, even on a match", async () => {
    await firstReview();
    db.tables.analyses.push(upload("second"));
    await processAnalysis("second", { fresh: true });

    expect(create).toHaveBeenCalledTimes(1);
    expect(row("second")).toMatchObject({ status: "complete", review_kind: "full" });
  });
});
