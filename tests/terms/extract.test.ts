import { readFile } from "node:fs/promises";
import path from "node:path";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { extractDocx } from "@/lib/docx";
import { contractText } from "@/lib/docx/contract-text";
import { HOTEL_TERM_CATALOG } from "@/lib/terms/catalog";
import { extractionRecord, extractTerms, termRows } from "@/lib/terms/extract";
import type { TermCatalog } from "@/lib/terms/types";

/**
 * One extraction pass end to end, with the model mocked: the request it sends,
 * then validation and verification against a real eval contract.
 */

const { create } = vi.hoisted(() => ({ create: vi.fn() }));

vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = { create };
  },
}));

const respond = (terms: unknown[]) => ({
  content: [{ type: "tool_use", id: "toolu_test", name: "record_contract_terms", input: { terms } }],
  stop_reason: "tool_use",
  usage: { input_tokens: 1000, output_tokens: 200, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
});

const CONTRACT = path.join("data", "sample-contracts", "eval", "eval-01-harborview.docx");
const DRAFT = path.join("data", "sample-contracts", "eval", "eval-01-harborview.draft.json");

let text = "";
let parts: { part: string; text: string }[] = [];
let anchor: (clause: string, field: string) => string;

beforeAll(async () => {
  const extracted = await extractDocx(new Uint8Array(await readFile(CONTRACT)));
  parts = extracted.parts;
  text = contractText(extracted);
  const drafted: { clause_type: string; anchors: { field: string; sentence: string }[] }[] = JSON.parse(await readFile(DRAFT, "utf8"));
  anchor = (clause, field) => drafted.find((c) => c.clause_type === clause)!.anchors.find((a) => a.field === field)!.sentence;
});

beforeEach(() => {
  create.mockReset();
  vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
});

const entry = (term_key: string, value: unknown, quoted_text: string) => ({
  term_key,
  value,
  quoted_text,
  source_section: null,
  confidence: "high",
});

describe("a term extraction pass over eval-01", () => {
  it("sends the contract text and the catalog", async () => {
    create.mockResolvedValue(respond([]));
    await extractTerms({ document: { kind: "text", text }, parts });

    const request = create.mock.calls[0][0];
    expect(request.system[1].text).toContain("TERM CATALOG (version hotel-v1)");
    expect(request.system[1].cache_control).toEqual({ type: "ephemeral" });
    expect(request.tools[0].input_schema.properties.terms.items.properties.term_key.enum).toHaveLength(
      HOTEL_TERM_CATALOG.terms.length
    );
    expect(request.messages[0].content[0].text).toBe(`CONTRACT TEXT:\n\n${text}`);
  });

  it("verifies, locates, contradicts and rejects as the document warrants", async () => {
    create.mockResolvedValue(
      respond([
        entry("attrition.threshold", 90, anchor("attrition", "threshold")),
        entry("attrition.basis", "night_by_night", anchor("attrition", "basis")),
        entry("deal.group_rate_usd", 289, "a group rate of $289.00 per room, per night"),
        entry("cancellation.top_tier_pct", 100, "100%"),
        entry("attrition.liability_rate", 85, anchor("attrition", "liability_rate")),
        entry("cutoff_date.days_prior", 45, "Reservations are due forty-five (45) days before arrival."),
        entry("attrition.grace_nights", 2, "two (2) nights"),
      ])
    );

    const { terms, model_id } = await extractTerms({ document: { kind: "text", text }, parts });
    const status = Object.fromEntries(terms.stated.map((t) => [t.term_key, t.verification]));

    expect(model_id).toBe("claude-sonnet-5");
    expect(status).toEqual({
      "attrition.threshold": "verified",
      "attrition.basis": "located",
      "deal.group_rate_usd": "verified",
      "cancellation.top_tier_pct": "verified",
      "attrition.liability_rate": "contradicted",
      "cutoff_date.days_prior": "unlocated",
    });
    expect(terms.rejected.map((r) => r.term_key)).toEqual(["attrition.grace_nights"]);
    expect(terms.not_stated).toHaveLength(HOTEL_TERM_CATALOG.terms.length - 6);
  });

  it("gives every catalog key a row, and records the pass", async () => {
    create.mockResolvedValue(respond([entry("attrition.threshold", 90, anchor("attrition", "threshold"))]));
    const outcome = await extractTerms({ document: { kind: "text", text }, parts });

    const rows = termRows("analysis-1", outcome.terms);
    expect(rows).toHaveLength(HOTEL_TERM_CATALOG.terms.length);
    expect(rows.find((r) => r.term_key === "attrition.threshold")).toMatchObject({
      status: "stated",
      term_value: 0.9,
      unit: "pct",
      verification: "verified",
    });
    expect(rows.find((r) => r.term_key === "cutoff_date.days_prior")).toMatchObject({
      status: "not_stated",
      term_value: null,
      unit: "days",
      verification: null,
    });

    const record = extractionRecord({ ok: true, ...outcome });
    expect(record).toMatchObject({
      status: "complete",
      catalog_version: "hotel-v1",
      stated: 1,
      not_stated: HOTEL_TERM_CATALOG.terms.length - 1,
      verification: { verified: 1, located: 0, contradicted: 0, unlocated: 0 },
    });
  });
});

describe("a catalog from another vertical", () => {
  // The extraction code reads no hotel term by name. A different catalog is
  // the whole of what retooling it takes.
  const SAAS: TermCatalog = {
    version: "saas-v1",
    terms: [
      { key: "uptime.monthly_pct", kind: "number", unit: "pct", meaning: "Guaranteed availability per calendar month." },
      { key: "support.response_hours", kind: "number", unit: "hours", meaning: "Hours within which support must respond." },
    ],
  };
  const saasText = "The Service will be available 99.9% of each calendar month. Support will respond within four (4) hours.";

  it("extracts and verifies against it unchanged", async () => {
    create.mockResolvedValue(
      respond([
        entry("uptime.monthly_pct", 99.9, "available 99.9% of each calendar month"),
        entry("support.response_hours", 4, "respond within four (4) hours"),
      ])
    );

    const { terms } = await extractTerms({
      document: { kind: "text", text: saasText },
      parts: [{ part: "document", text: saasText }],
      catalog: SAAS,
    });

    const request = create.mock.calls[0][0];
    expect(request.tools[0].input_schema.properties.terms.items.properties.term_key.enum).toEqual([
      "uptime.monthly_pct",
      "support.response_hours",
    ]);
    expect(request.system[1].text).not.toMatch(/attrition/);
    expect(terms.stated.map((t) => [t.term_key, t.value, t.verification])).toEqual([
      ["uptime.monthly_pct", 0.999, "verified"],
      ["support.response_hours", 4, "verified"],
    ]);
  });
});
