import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb, type Tables } from "./helpers/fake-db";
import { buildDocx, para, run } from "./helpers/docx-package";

/**
 * Historical contracts: an admin uploads a signed contract from before the
 * tool, with its details, for the Analytics tab. Its terms reach the model
 * only while HISTORICAL_EXTRACTION is on, never past a clause restricting AI
 * review without an admin's say-so, and only checked terms reach Analytics.
 */

const state = vi.hoisted(() => ({
  tables: {} as Record<string, Record<string, unknown>[]>,
  files: {} as Record<string, Uint8Array>,
  associate: null as null | { id: string; is_admin: boolean; name: string; email: string; signature_block: null },
  audit: [] as Record<string, unknown>[],
  after: [] as (() => Promise<unknown>)[],
  modelCalls: 0,
}));

vi.mock("next/server", async (original) => ({
  ...(await original<typeof import("next/server")>()),
  after: (task: () => Promise<unknown>) => void state.after.push(task),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => fakeDb(state.tables as Tables, state.files) }));
vi.mock("@/lib/current-associate", () => ({ getCurrentAssociate: async () => state.associate }));
vi.mock("@/lib/audit", () => ({ logAudit: async (entry: Record<string, unknown>) => void state.audit.push(entry) }));
vi.mock("@/lib/anthropic", () => ({
  extractContractTerms: async () => {
    state.modelCalls++;
    return {
      entries: [
        { term_key: "attrition.threshold", value: 80, quoted_text: "eighty percent (80%)", confidence: "high" },
        { term_key: "commission.commission_pct", value: 10, quoted_text: "a quoted span that is not in the contract", confidence: "high" },
      ],
      model_id: "claude-sonnet-5",
      input_tokens: 1,
      output_tokens: 1,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
    };
  },
}));

import { POST as upload } from "@/app/api/admin/historical/route";
import { POST as extractAgain } from "@/app/api/admin/historical/[id]/extract/route";
import { DELETE as remove } from "@/app/api/admin/historical/[id]/route";
import { historicalRecords } from "@/lib/analytics/historical";
import type { HistoricalContract } from "@/lib/historical/types";

const ADMIN = { id: "admin-1", is_admin: true, name: "Admin", email: "a@example.com", signature_block: null };

const DETAILS = {
  hotel_name: "Harbor Grand Denver",
  brand: "Harbor Grand",
  city: "Denver",
  state: "CO",
  market_tier: "upscale",
  client_name: "Acme Association",
  signed_at: "2025-03-14",
};

async function form(text: string, details: Record<string, string> = DETAILS) {
  const body = new FormData();
  const bytes = await buildDocx(para(run(text)));
  body.append("file", new File([bytes as Uint8Array<ArrayBuffer>], "harbor.docx", { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }));
  for (const [key, value] of Object.entries(details)) body.append(key, value);
  return new Request("http://localhost", { method: "POST", body });
}

const params = (id: string) => ({ params: Promise.resolve({ id }) });
const runAfter = async () => {
  for (const task of state.after.splice(0)) await task();
};

beforeEach(() => {
  state.tables = { historical_contracts: [], contract_terms: [], associates: [] };
  state.files = {};
  state.associate = ADMIN;
  state.audit = [];
  state.after = [];
  state.modelCalls = 0;
  vi.unstubAllEnvs();
});

describe("uploading", () => {
  it("is for admins only", async () => {
    state.associate = { ...ADMIN, is_admin: false };
    expect((await upload(await form("Attrition is eighty percent (80%)."))).status).toBe(403);
    expect(state.tables.historical_contracts).toHaveLength(0);
  });

  it("stores the file and details without a model call while extraction is off", async () => {
    const res = await upload(await form("Attrition is eighty percent (80%)."));
    expect(res.status).toBe(201);
    const [row] = state.tables.historical_contracts;
    expect(row).toMatchObject({ hotel_name: "Harbor Grand Denver", extraction_status: "stored", source_format: "docx" });
    expect(Object.keys(state.files)).toEqual([row.storage_path]);
    expect(state.after).toHaveLength(0);
    expect(state.modelCalls).toBe(0);
  });

  it("refuses missing details before storing anything", async () => {
    const res = await upload(await form("x", { ...DETAILS, signed_at: "" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/signed/);
    expect(state.files).toEqual({});
  });
});

describe("reading terms", () => {
  it("stores only checked terms against the upload, once switched on", async () => {
    vi.stubEnv("HISTORICAL_EXTRACTION", "on");
    await upload(await form("Attrition is eighty percent (80%) of the block."));
    expect(state.tables.historical_contracts[0].extraction_status).toBe("pending");
    await runAfter();

    const [row] = state.tables.historical_contracts;
    expect(row.extraction_status).toBe("done");
    expect(state.modelCalls).toBe(1);
    const stated = state.tables.contract_terms.filter((t) => t.status === "stated");
    expect(stated.every((t) => t.historical_contract_id === row.id && !("analysis_id" in t))).toBe(true);

    const [record] = historicalRecords([row as unknown as HistoricalContract], state.tables.contract_terms as never, new Map());
    expect(record.final).toEqual({ "attrition.threshold": 80 });
    expect(record.final["commission.commission_pct"]).toBeUndefined();
  });

  it("holds a contract that restricts AI review until an admin goes ahead", async () => {
    vi.stubEnv("HISTORICAL_EXTRACTION", "on");
    await upload(await form("The hotel forbids use of artificial intelligence to review this agreement."));
    await runAfter();
    const [row] = state.tables.historical_contracts;
    expect(row.extraction_status).toBe("blocked_ai_clause");
    expect(state.modelCalls).toBe(0);

    expect((await extractAgain(new Request("http://localhost", { method: "POST", body: "{}" }), params(row.id as string))).status).toBe(409);
    const go = await extractAgain(new Request("http://localhost", { method: "POST", body: JSON.stringify({ proceed: true }) }), params(row.id as string));
    expect(go.status).toBe(200);
    await runAfter();
    expect(state.modelCalls).toBe(1);
    expect(state.audit.map((a) => a.action)).toContain("ai_clause_scan_overridden");
  });
});

describe("removing", () => {
  it("deletes the row and the stored file", async () => {
    await upload(await form("x"));
    const [row] = state.tables.historical_contracts;
    expect((await remove(new Request("http://localhost"), params(row.id as string))).status).toBe(200);
    expect(state.tables.historical_contracts).toHaveLength(0);
    expect(state.files).toEqual({});
  });
});

describe("Analytics records", () => {
  const contract = {
    id: "h1",
    hotel_name: "Harbor Grand Denver",
    brand: "Harbor Grand",
    parent_company: null,
    city: "Denver",
    state: "CO",
    country: "United States",
    market_tier: "upscale",
    client_name: "Acme",
    negotiated_by: "assoc-9",
    event_start: null,
    event_end: null,
    signed_at: "2025-03-14",
  } as unknown as HistoricalContract;

  it("keeps unstated, unchecked and mistyped terms missing", () => {
    const t = (term_key: string, term_value: unknown, verification: string | null = "verified", status = "stated") => ({
      historical_contract_id: "h1",
      term_key,
      term_value,
      verification,
      status: status as "stated",
    });
    const [record] = historicalRecords(
      [contract],
      [
        t("deal.group_rate_usd", 219),
        t("cutoff_date.days_prior", 30, "contradicted"),
        t("rate_parity.guaranteed", "yes"),
        t("attrition.threshold", null, null, "not_stated"),
        t("force_majeure.covers_epidemic", true, "located"),
      ],
      new Map([["assoc-9", "Dana"]])
    );
    expect(record.final).toEqual({ "deal.group_rate_usd": 219, "force_majeure.covers_epidemic": true });
    expect(record).toMatchObject({ source: "historical", status: "signed", signedAt: "2025-03-14", eventStart: "2025-03-14", historicalId: "h1" });
    expect(record.associate).toEqual({ id: "assoc-9", name: "Dana" });
    expect(record.property.guestRooms).toBeUndefined();
  });
});
