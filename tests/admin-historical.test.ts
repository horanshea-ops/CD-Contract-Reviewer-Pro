import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb, type Tables } from "./helpers/fake-db";
import { buildDocx, para, run } from "./helpers/docx-package";

/**
 * Historical contracts: an admin drops hundreds of past contracts and types
 * nothing. Each file's text is read locally at upload. The model reads the
 * details and terms in batches, only while HISTORICAL_EXTRACTION is on, and
 * never past a clause restricting AI review without an admin's say-so. Every
 * detail it gives is checked against the contract's words before it's kept.
 */

const state = vi.hoisted(() => ({
  tables: {} as Record<string, Record<string, unknown>[]>,
  files: {} as Record<string, Uint8Array>,
  associate: null as null | { id: string; is_admin: boolean; name: string; email: string; signature_block: null },
  audit: [] as Record<string, unknown>[],
  sent: [] as { custom_id: string; params: Record<string, unknown> }[],
  results: null as unknown,
}));

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => fakeDb(state.tables as Tables, state.files) }));
vi.mock("@/lib/current-associate", () => ({ getCurrentAssociate: async () => state.associate }));
vi.mock("@/lib/audit", () => ({ logAudit: async (entry: Record<string, unknown>) => void state.audit.push(entry) }));
vi.mock("@/lib/anthropic", async (original) => ({
  ...(await original<typeof import("@/lib/anthropic")>()),
  sendHistoricalBatch: async (requests: { custom_id: string; params: Record<string, unknown> }[]) => {
    state.sent.push(...requests);
    return "msgbatch_test";
  },
  collectHistoricalBatch: async () => state.results,
}));

import { POST as upload } from "@/app/api/admin/historical/route";
import { DELETE as remove, PATCH as edit } from "@/app/api/admin/historical/[id]/route";
import { POST as queue } from "@/app/api/admin/historical/[id]/queue/route";
import { GET as collect, POST as send } from "@/app/api/admin/historical/batch/route";
import { historicalRecords } from "@/lib/analytics/historical";
import { checkDetails } from "@/lib/historical/details";
import type { HistoricalContract } from "@/lib/historical/types";

const ADMIN = { id: "admin-1", is_admin: true, name: "Admin", email: "a@example.com", signature_block: null };

const CONTRACT =
  "This Group Sales Agreement is between the Harbor Grand Denver, a Westin hotel, and the Acme Association. " +
  "The hotel is located in Denver, Colorado. Attrition is eighty percent (80%) of the block. " +
  "Signed on March 14, 2025 by Dana Whitfield of ConferenceDirect.";

async function fileRequest(text: string, name = "harbor.docx") {
  const body = new FormData();
  const bytes = await buildDocx(para(run(text)));
  body.append("file", new File([bytes as Uint8Array<ArrayBuffer>], name, { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }));
  return new Request("http://localhost", { method: "POST", body });
}

const json = (body: unknown) => new Request("http://localhost", { method: "POST", body: JSON.stringify(body) });
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const detail = (value: string, quoted_text: string) => ({ value, quoted_text });

function reading(id: string) {
  return {
    custom_id: id,
    ok: true,
    reading: {
      details: {
        hotel_name: detail("Harbor Grand Denver", "the Harbor Grand Denver"),
        brand: detail("Westin", "a Westin hotel"),
        city: detail("Denver", "located in Denver, Colorado"),
        state: detail("co", "Denver, Colorado"),
        country: null,
        client_name: detail("Acme Association", "the Acme Association"),
        signed_date: detail("2025-03-14", "Signed on March 14, 2025"),
        event_start: null,
        event_end: null,
        negotiated_by: detail("Dana Whitfield", "Dana Whitfield of ConferenceDirect"),
        parent_company: "Marriott International",
        market_tier: "upper_upscale",
      },
      entries: [{ term_key: "attrition.threshold", value: 80, quoted_text: "eighty percent (80%)", confidence: "high" }],
      model_id: "claude-sonnet-5",
      input_tokens: 1,
      output_tokens: 1,
    },
  };
}

beforeEach(() => {
  state.tables = {
    historical_contracts: [],
    historical_batches: [],
    contract_terms: [],
    associates: [{ id: "assoc-9", name: "Dana Whitfield" }],
  };
  state.files = {};
  state.associate = ADMIN;
  state.audit = [];
  state.sent = [];
  state.results = null;
  vi.unstubAllEnvs();
  vi.stubEnv("HISTORICAL_CONTRACTS", "on");
});

describe("archived, with HISTORICAL_CONTRACTS off", () => {
  beforeEach(() => vi.stubEnv("HISTORICAL_CONTRACTS", ""));

  it("answers not found on every admin route, and stores nothing", async () => {
    state.tables.historical_contracts.push({ id: "h1", extraction_status: "failed", storage_path: "historical/h1/a.pdf" });

    expect((await upload(await fileRequest(CONTRACT))).status).toBe(404);
    expect((await edit(json({ city: "Denver" }), params("h1"))).status).toBe(404);
    expect((await remove(new Request("http://localhost"), params("h1"))).status).toBe(404);
    expect((await queue(json({}), params("h1"))).status).toBe(404);
    expect((await send()).status).toBe(404);
    expect((await collect()).status).toBe(404);

    expect(state.tables.historical_contracts).toHaveLength(1);
    expect(state.audit).toHaveLength(0);
  });

  it("still tells a signed-out caller to sign in, and a non-admin they need admin access", async () => {
    state.associate = null;
    expect((await send()).status).toBe(401);
    state.associate = { ...ADMIN, is_admin: false };
    expect((await send()).status).toBe(403);
  });

  it("sends the screen's address to Users, and answers not found for a contract's file", async () => {
    const { default: Page } = await import("@/app/(app)/admin/contracts/page");
    await expect(Page()).rejects.toMatchObject({ digest: expect.stringContaining("NEXT_REDIRECT;replace;/admin/users;") });

    state.tables.historical_contracts.push({ id: "h1", storage_path: "historical/h1/a.pdf", source_format: "pdf", file_name: "a.pdf" });
    state.files["historical/h1/a.pdf"] = new Uint8Array([1]);
    const { GET: file } = await import("@/app/api/historical/[id]/file/route");
    expect((await file(new Request("http://localhost"), params("h1"))).status).toBe(404);

    vi.stubEnv("ANALYTICS", "on");
    expect((await file(new Request("http://localhost"), params("h1"))).status).toBe(200);
  });
});

describe("uploading", () => {
  it("is for admins only", async () => {
    state.associate = { ...ADMIN, is_admin: false };
    expect((await upload(await fileRequest(CONTRACT))).status).toBe(403);
    expect(state.tables.historical_contracts).toHaveLength(0);
  });

  it("needs no details, reads the text locally, and calls no model", async () => {
    expect((await upload(await fileRequest(CONTRACT))).status).toBe(201);
    const [row] = state.tables.historical_contracts;
    expect(row).toMatchObject({ extraction_status: "waiting", source_format: "docx" });
    expect(row.hotel_name ?? null).toBeNull();
    expect(row.contract_text).toContain("Harbor Grand Denver");
    expect(state.sent).toHaveLength(0);
  });

  it("skips a file already uploaded", async () => {
    await upload(await fileRequest(CONTRACT, "a.docx"));
    const again = await upload(await fileRequest(CONTRACT, "copy of a.docx"));
    expect(await again.json()).toMatchObject({ duplicate: true });
    expect(state.tables.historical_contracts).toHaveLength(1);
    expect(Object.keys(state.files)).toHaveLength(1);
  });

  it("holds back a contract that restricts AI review", async () => {
    await upload(await fileRequest("No artificial intelligence may be used to review this agreement."));
    expect(state.tables.historical_contracts[0].extraction_status).toBe("blocked_ai_clause");
  });
});

describe("reading in batches", () => {
  it("sends nothing while the switch is off", async () => {
    await upload(await fileRequest(CONTRACT));
    expect((await send()).status).toBe(409);
    expect(state.sent).toHaveLength(0);
  });

  it("sends waiting contracts keyed by id, and leaves held ones out", async () => {
    vi.stubEnv("HISTORICAL_EXTRACTION", "on");
    await upload(await fileRequest(CONTRACT));
    await upload(await fileRequest("No artificial intelligence may be used."));
    const res = await send();
    expect(await res.json()).toEqual({ sent: 1, remaining: 0 });

    const [waiting] = state.tables.historical_contracts.filter((r) => r.extraction_status === "reading");
    expect(state.sent.map((r) => r.custom_id)).toEqual([waiting.id]);
    expect(waiting.batch_id).toBe(state.tables.historical_batches[0].id);
  });

  it("stores checked details and terms when the batch ends, matching results by id", async () => {
    vi.stubEnv("HISTORICAL_EXTRACTION", "on");
    await upload(await fileRequest(CONTRACT, "a.docx"));
    await upload(await fileRequest(`${CONTRACT} Second copy with a change.`, "b.docx"));
    await send();
    const [a, b] = state.tables.historical_contracts;

    expect(await (await collect()).json()).toMatchObject({ collected: 0, stillReading: 2 });

    state.results = [{ custom_id: b.id, ok: false, error: "The batch request errored." }, reading(a.id as string)];
    expect(await (await collect()).json()).toEqual({ collected: 2, stillReading: 0 });

    expect(a).toMatchObject({
      extraction_status: "done",
      hotel_name: "Harbor Grand Denver",
      state: "CO",
      signed_at: "2025-03-14",
      negotiated_by: "assoc-9",
      market_tier: "upper_upscale",
    });
    expect(a.details_checked).toMatchObject({ hotel_name: "checked", market_tier: "guessed", parent_company: "guessed" });
    expect(b.extraction_status).toBe("failed");
    expect(state.tables.historical_batches[0].status).toBe("ended");

    const [record] = historicalRecords([a as unknown as HistoricalContract], state.tables.contract_terms as never, new Map());
    expect(record.final).toEqual({ "attrition.threshold": 80 });
    expect(record.property).toMatchObject({ brand: "Westin", tier: "upper_upscale", parentCompany: "Marriott International" });
  });
});

describe("checking details", () => {
  const parts = [{ part: "document", text: CONTRACT }] as never;
  const associates = [{ id: "assoc-9", name: "Dana Whitfield" }];

  it("drops a detail whose words aren't in the contract, and a date that isn't one", () => {
    const { values, dropped } = checkDetails(
      {
        hotel_name: detail("Harbor Grand Denver", "the Harbor Grand Downtown"),
        signed_date: detail("March 14", "Signed on March 14, 2025"),
        client_name: detail("Acme Association", "the Acme Association"),
      },
      parts,
      associates
    );
    expect(values).toMatchObject({ hotel_name: null, signed_at: null, client_name: "Acme Association" });
    expect(dropped.map((d) => d.field)).toEqual(["hotel_name", "signed_at"]);
  });

  it("leaves negotiated-by empty unless it names one associate", () => {
    const { values } = checkDetails({ negotiated_by: detail("Pat Nobody", "Signed on March 14, 2025") }, parts, associates);
    expect(values.negotiated_by).toBeNull();
  });

  it("marks inferred details as guesses and refuses an unknown tier", () => {
    const guessed = checkDetails({ parent_company: "Marriott International", market_tier: "upper_upscale" }, parts, associates);
    expect(guessed.checked).toEqual({ parent_company: "guessed", market_tier: "guessed" });
    expect(checkDetails({ market_tier: "boutique" }, parts, associates).values.market_tier).toBeNull();
  });
});

describe("admin actions", () => {
  it("records an edit as the admin's", async () => {
    await upload(await fileRequest(CONTRACT));
    const [row] = state.tables.historical_contracts;
    const res = await edit(json({ hotel_name: "Harbor Grand", signed_at: "2025-03-14", market_tier: "upscale" }), params(row.id as string));
    expect(res.status).toBe(200);
    expect(row.details_checked).toEqual({ hotel_name: "edited", signed_at: "edited", market_tier: "edited" });
    expect((await edit(json({ signed_at: "14/03/2025" }), params(row.id as string))).status).toBe(400);
  });

  it("sends a held contract only once an admin goes ahead", async () => {
    await upload(await fileRequest("No artificial intelligence may be used."));
    const [row] = state.tables.historical_contracts;
    expect((await queue(json({}), params(row.id as string))).status).toBe(409);
    expect((await queue(json({ proceed: true }), params(row.id as string))).status).toBe(200);
    expect(row.extraction_status).toBe("waiting");
    expect(state.audit.map((a) => a.action)).toContain("ai_clause_scan_overridden");
  });

  it("removes the row and the stored file", async () => {
    await upload(await fileRequest(CONTRACT));
    const [row] = state.tables.historical_contracts;
    expect((await remove(new Request("http://localhost"), params(row.id as string))).status).toBe(200);
    expect(state.tables.historical_contracts).toHaveLength(0);
    expect(state.files).toEqual({});
  });
});

describe("Analytics records", () => {
  it("counts an upload only once it has a hotel, city, signed date and tier", () => {
    const base = { id: "h1", hotel_name: "H", city: "Denver", signed_at: "2025-01-01", market_tier: "upscale", brand: null } as unknown as HistoricalContract;
    expect(historicalRecords([base], [], new Map())[0].property.brand).toBe("Independent");
    expect(historicalRecords([{ ...base, market_tier: null }], [], new Map())).toEqual([]);
    expect(historicalRecords([{ ...base, signed_at: null }], [], new Map())).toEqual([]);
  });
});
