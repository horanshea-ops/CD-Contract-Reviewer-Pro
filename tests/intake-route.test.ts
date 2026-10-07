import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb, type Tables } from "./helpers/fake-db";
import { buildDocx, para, run, table } from "./helpers/docx-package";

/**
 * The read a contract gets when an associate picks it, before any upload.
 *
 * It fills the property name and picks the standards for the associate to
 * confirm. It must change nothing: no stored file, no row, no audit entry, no
 * model call. It offers only the sets a review would really use, which is the
 * loader's own rule.
 */

const state = vi.hoisted(() => ({
  tables: {} as Record<string, Record<string, unknown>[]>,
  files: {} as Record<string, Uint8Array>,
  associate: null as null | { id: string; is_admin: boolean; name: string; email: string; signature_block: null },
  audit: [] as Record<string, unknown>[],
  modelCalls: 0,
}));

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => fakeDb(state.tables as Tables, state.files) }));
vi.mock("@/lib/current-associate", () => ({ getCurrentAssociate: async () => state.associate }));
vi.mock("@/lib/audit", () => ({ logAudit: async (entry: Record<string, unknown>) => void state.audit.push(entry) }));
vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = {
      create: async () => {
        state.modelCalls++;
        throw new Error("the read must not call a model");
      },
    };
  },
}));

import { GET as brands, POST as read } from "@/app/api/analyses/read/route";
import { loadStandardsLibrary } from "@/lib/standards/load";
import { brandChoices, brandOnNegotiation, usableSets } from "@/lib/standards/usable";

const ASSOCIATE = { id: "assoc-1", is_admin: false, name: "Jo", email: "jo@example.com", signature_block: null };
const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

const set = (key: string, name: string, over: Record<string, unknown> = {}) => ({
  key,
  name,
  brand_names: key === "independent" ? [] : [name],
  is_default: false,
  is_active: false,
  source_document: "",
  source_date: null,
  ...over,
});
const standard = (set_key: string, clause_type = "attrition", over: Record<string, unknown> = {}) => ({
  set_key,
  clause_type,
  segment: "default",
  category: "business",
  position: "p",
  fallback_language: "f",
  walk_away_condition: "",
  severity_default: "high",
  compromise_range: "",
  version: "v1",
  provenance: "extracted",
  retired_at: null,
  ...over,
});

async function request(body: string | Uint8Array, name = "contract.docx", type = DOCX) {
  const form = new FormData();
  const bytes = typeof body === "string" ? await buildDocx(body) : body;
  form.append("file", new File([bytes as Uint8Array<ArrayBuffer>], name, { type }));
  return new Request("http://localhost", { method: "POST", body: form });
}

const PARTY = (hotel: string) => para(run(`This Agreement is entered into between ${hotel}, located in Sampleville, Ohio (the "Hotel"), and Acme Association (the "Group").`));

beforeEach(() => {
  state.tables = {
    standard_sets: [
      set("independent", "Independent", { is_default: true, is_active: true }),
      set("hilton", "Hilton", { is_active: true }),
      set("hyatt", "Hyatt"),
    ],
    standards: [standard("independent"), standard("hilton"), standard("hyatt")],
  };
  state.files = {};
  state.associate = ASSOCIATE;
  state.audit = [];
  state.modelCalls = 0;
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://db");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "key");
});

describe("who may read, and what", () => {
  it("refuses a signed-out caller", async () => {
    state.associate = null;
    expect((await read(await request(PARTY("Seaside Grand Resort")))).status).toBe(401);
  });

  it("refuses a file that isn't a contract format, and one over the size limit", async () => {
    expect((await read(await request(new Uint8Array([1, 2, 3]), "notes.txt", "text/plain"))).status).toBe(400);

    const form = new FormData();
    form.append("file", new File([new Uint8Array(33 * 1024 * 1024)], "big.pdf", { type: "application/pdf" }));
    expect((await read(new Request("http://localhost", { method: "POST", body: form }))).status).toBe(400);
  });
});

describe("what the read returns", () => {
  it("gives the property name with the wording it came from", async () => {
    const body = await (await read(await request(PARTY("Seaside Grand Resort")))).json();

    expect(body.propertyName.value).toBe("Seaside Grand Resort");
    expect(body.propertyName.evidence).toContain('(the "Hotel")');
    expect(body.brand).toEqual({ brand: null, set: null, evidence: null, note: null });
  });

  it("reads a table row, as a Word contract lays it out", async () => {
    const body = await (await read(await request(table([["Organization:", "Acme"], ["Hotel:", "Granite Bay Lodge"]])))).json();
    expect(body.propertyName).toEqual({ value: "Granite Bay Lodge", evidence: "Hotel: Granite Bay Lodge" });
  });

  it("names the brand the contract names, with its standards set", async () => {
    const body = await (await read(await request(PARTY("Hilton Sampleville Downtown")))).json();
    expect(body.brand).toMatchObject({ brand: "Hilton", set: "hilton", evidence: "Hilton Sampleville Downtown" });
  });

  it("names a brand whose standards are off, since the hotel is still that brand", async () => {
    const body = await (await read(await request(PARTY("Hyatt Regency Sampleville")))).json();

    expect(body.brand).toMatchObject({ brand: "Hyatt Regency", set: "hyatt" });
    expect(body.sets.find((s: { key: string }) => s.key === "hyatt")).toMatchObject({ in_use: false });
  });

  it("names a brand that has no standards of its own", async () => {
    const body = await (await read(await request(PARTY("Sampleville Marriott Marquis")))).json();
    expect(body.brand).toMatchObject({ brand: "Marriott", set: null, note: null });
  });

  it("lists every set of standards, Independent first, with its brand names and whether it is in use", async () => {
    const body = await (await read(await request(PARTY("Seaside Grand Resort")))).json();
    expect(body.sets).toEqual([
      { key: "independent", name: "Independent", brand_names: [], is_default: true, in_use: true },
      { key: "hilton", name: "Hilton", brand_names: ["Hilton"], is_default: false, in_use: true },
      { key: "hyatt", name: "Hyatt", brand_names: ["Hyatt"], is_default: false, in_use: false },
    ]);
  });

  it("returns empty fields for a file it can't open, so the associate types them", async () => {
    const res = await read(await request(new Uint8Array([1, 2, 3, 4]), "broken.docx"));

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ propertyName: null, brand: { brand: null, set: null } });
  });
});

describe("what the read leaves alone", () => {
  it("stores no file, writes no row or audit entry, and calls no model", async () => {
    const before = JSON.stringify(state.tables);
    await read(await request(PARTY("Hilton Sampleville Downtown")));

    expect(JSON.stringify(state.tables)).toBe(before);
    expect(state.files).toEqual({});
    expect(state.audit).toEqual([]);
    expect(state.modelCalls).toBe(0);
  });
});

describe("the sets offered and the sets the loader reads", () => {
  it("agree, set by set", async () => {
    // Hilton on with a standard, Hyatt off, and a third set on with nothing in use.
    state.tables.standard_sets.push(set("marriott", "Marriott", { is_active: true }));
    state.tables.standards.push(standard("marriott", "attrition", { retired_at: "2026-10-01T00:00:00Z" }));

    const offered = (await usableSets(fakeDb(state.tables as Tables) as never)).map((s) => s.key);
    expect(offered).toEqual(["independent", "hilton"]);

    for (const key of ["independent", "hilton", "hyatt", "marriott"]) {
      const loaded = await loadStandardsLibrary(key);
      expect(loaded.set === key, key).toBe(offered.includes(key));
    }
  });
});

describe("the brand list, before any file is picked", () => {
  it("is for signed-in associates", async () => {
    state.associate = null;
    expect((await brands()).status).toBe(401);
  });

  it("lists every brand with whether its standards are in use", async () => {
    expect((await (await brands()).json()).sets.map((s: { key: string; in_use: boolean }) => [s.key, s.in_use])).toEqual([
      ["independent", true],
      ["hilton", true],
      ["hyatt", false],
    ]);
  });
});

describe("the brand a new negotiation records", () => {
  const choices = () => brandChoices(fakeDb(state.tables as Tables) as never);

  it("records no brand and the default set for an independent hotel", async () => {
    expect(brandOnNegotiation(null, await choices())).toEqual({ brand: null, set: null });
    expect(brandOnNegotiation("   ", await choices())).toEqual({ brand: null, set: null });
  });

  it("records a brand with standards of its own, and its set", async () => {
    expect(brandOnNegotiation("Hilton", await choices())).toEqual({ brand: "Hilton", set: "hilton" });
    expect(brandOnNegotiation(" DoubleTree  by Hilton ", await choices())).toEqual({ brand: "DoubleTree by Hilton", set: "hilton" });
  });

  it("records a brand with no standards of its own as typed, on the default set", async () => {
    expect(brandOnNegotiation("Marriott", await choices())).toEqual({ brand: "Marriott", set: null });
    expect(brandOnNegotiation("Conrad", await choices())).toEqual({ brand: "Conrad", set: null });
  });

  it("records a brand whose standards are off, and the review then reads Independent and says so", async () => {
    expect(brandOnNegotiation("Hyatt Regency", await choices())).toEqual({ brand: "Hyatt Regency", set: "hyatt" });

    const loaded = await loadStandardsLibrary("hyatt");
    expect(loaded).toMatchObject({ set: "independent", requestedSet: "hyatt" });
    expect(loaded.setNote).toBe("Hyatt's standards are switched off, so this review used Independent.");
  });

  it("keeps a typed brand to a sensible length", async () => {
    expect(brandOnNegotiation("x".repeat(300), await choices()).brand).toHaveLength(80);
  });
});
