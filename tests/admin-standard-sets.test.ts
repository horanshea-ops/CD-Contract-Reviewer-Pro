import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb, type Tables } from "./helpers/fake-db";

/**
 * Switching a standards set on or off, and starting one from a copy of
 * Independent. A set that is on is the whole library for its brand's reviews,
 * so an empty one can't be switched on, and nothing an admin wrote is ever
 * copied over.
 */

const state = vi.hoisted(() => ({
  tables: {} as Record<string, Record<string, unknown>[]>,
  associate: null as null | { id: string; is_admin: boolean; name: string; email: string; signature_block: null },
  audit: [] as Record<string, unknown>[],
}));

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => fakeDb(state.tables as Tables) }));
vi.mock("@/lib/current-associate", () => ({ getCurrentAssociate: async () => state.associate }));
vi.mock("@/lib/audit", () => ({ logAudit: async (entry: Record<string, unknown>) => void state.audit.push(entry) }));

import { PATCH as switchSet, POST as copyInto } from "@/app/api/admin/standard-sets/[key]/route";
import { loadStandardsLibrary } from "@/lib/standards/load";

const ADMIN = { id: "admin-1", is_admin: true, name: "Admin", email: "a@example.com", signature_block: null };

const set = (key: string, name: string, over: Record<string, unknown> = {}) => ({
  key,
  name,
  brand_names: [],
  is_default: false,
  is_active: false,
  source_document: "",
  source_date: null,
  ...over,
});

const standard = (set_key: string, clause_type: string, over: Record<string, unknown> = {}) => ({
  id: `${set_key}-${clause_type}`,
  set_key,
  clause_type,
  segment: "default",
  category: "business",
  position: "p",
  fallback_language: "f",
  walk_away_condition: "",
  severity_default: "medium",
  compromise_range: "",
  version: "v1-industry-default",
  provenance: "cd_validated",
  validated_by: "someone",
  validated_at: "2026-09-01T00:00:00Z",
  retired_at: null,
  ...over,
});

const json = (body: unknown) => new Request("http://localhost", { method: "POST", body: JSON.stringify(body) });
const params = (key: string) => ({ params: Promise.resolve({ key }) });
const inSet = (key: string) => state.tables.standards.filter((s) => s.set_key === key);

beforeEach(() => {
  state.tables = {
    standard_sets: [set("independent", "Independent", { is_default: true, is_active: true }), set("hilton", "Hilton"), set("hyatt", "Hyatt")],
    standards: [
      standard("independent", "attrition"),
      standard("independent", "cancellation", { provenance: "industry_default", validated_by: null, validated_at: null }),
      standard("independent", "old_clause", { retired_at: "2026-09-01T00:00:00Z" }),
    ],
  };
  state.associate = ADMIN;
  state.audit = [];
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://db");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "key");
});

describe("who can change a set", () => {
  it("refuses associates and signed-out visitors", async () => {
    for (const who of [{ ...ADMIN, is_admin: false }, null]) {
      state.associate = who;
      const expected = who ? 403 : 401;
      expect((await switchSet(json({ is_active: true }), params("hilton"))).status).toBe(expected);
      expect((await copyInto(json({}), params("hilton"))).status).toBe(expected);
    }
    expect(inSet("hilton")).toEqual([]);
  });
});

describe("copying Independent into an empty set", () => {
  it("copies the standards in use, and leaves removed ones behind", async () => {
    const res = await copyInto(json({}), params("hilton"));

    expect(res.status).toBe(201);
    expect(inSet("hilton").map((s) => s.clause_type).sort()).toEqual(["attrition", "cancellation"]);
    expect(inSet("independent")).toHaveLength(3);
    expect(state.audit).toEqual([
      expect.objectContaining({ action: "standard_set_copied", metadata: { set_key: "hilton", copied_from: "independent", standards: 2 } }),
    ]);
  });

  it("carries no validation stamp, since nobody has checked the copies against this brand", async () => {
    await copyInto(json({}), params("hilton"));
    const copy = inSet("hilton").find((s) => s.clause_type === "attrition")!;

    expect(copy).toMatchObject({ provenance: "extracted", validated_by: null, validated_at: null, updated_by: ADMIN.id });
    expect(copy.id).not.toBe("independent-attrition");
    // The original keeps its stamp.
    expect(inSet("independent").find((s) => s.clause_type === "attrition")).toMatchObject({ provenance: "cd_validated", validated_by: "someone" });
  });

  it("refuses a set that already has standards, removed ones included", async () => {
    state.tables.standards.push(standard("hilton", "attrition", { retired_at: "2026-10-01T00:00:00Z" }));
    const res = await copyInto(json({}), params("hilton"));

    expect(res.status).toBe(409);
    expect(inSet("hilton")).toHaveLength(1);
  });

  it("refuses Independent itself, and a set that doesn't exist", async () => {
    expect((await copyInto(json({}), params("independent"))).status).toBe(409);
    expect((await copyInto(json({}), params("marriott"))).status).toBe(404);
  });
});

describe("switching a set on or off", () => {
  it("refuses to switch on a set with no standards", async () => {
    const res = await switchSet(json({ is_active: true }), params("hilton"));

    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/no standards yet/);
    expect(state.tables.standard_sets.find((s) => s.key === "hilton")!.is_active).toBe(false);
  });

  it("switches a filled set on, and its reviews then read it alone", async () => {
    await copyInto(json({}), params("hilton"));
    expect((await loadStandardsLibrary("hilton")).set).toBe("independent");

    expect((await switchSet(json({ is_active: true }), params("hilton"))).status).toBe(200);

    const loaded = await loadStandardsLibrary("hilton");
    expect(loaded).toMatchObject({ set: "hilton", requestedSet: "hilton" });
    expect(loaded.setNote).toBeUndefined();
    expect(state.audit.at(-1)).toMatchObject({ action: "standard_set_switched_on", metadata: { set_key: "hilton", standards: 2 } });
  });

  it("switches a set off again, and its reviews go back to Independent", async () => {
    await copyInto(json({}), params("hilton"));
    await switchSet(json({ is_active: true }), params("hilton"));
    expect((await switchSet(json({ is_active: false }), params("hilton"))).status).toBe(200);

    expect(await loadStandardsLibrary("hilton")).toMatchObject({ set: "independent", requestedSet: "hilton" });
    expect(state.audit.at(-1)).toMatchObject({ action: "standard_set_switched_off" });
  });

  it("never switches Independent off", async () => {
    expect((await switchSet(json({ is_active: false }), params("independent"))).status).toBe(409);
    expect(state.tables.standard_sets.find((s) => s.key === "independent")!.is_active).toBe(true);
  });

  it("needs a plain on or off, and a set that exists", async () => {
    expect((await switchSet(json({ is_active: "yes" }), params("hilton"))).status).toBe(400);
    expect((await switchSet(json({ is_active: true }), params("marriott"))).status).toBe(404);
  });
});

describe("changing the brands a set covers", () => {
  const change = (key: string, brand_names: unknown) => switchSet(json({ brand_names }), params(key));
  const listOf = (key: string) => state.tables.standard_sets.find((s) => s.key === key)?.brand_names;

  beforeEach(() => {
    state.tables.standard_sets = [
      set("independent", "Independent", { is_default: true, is_active: true }),
      set("hilton", "Hilton", { brand_names: ["Hilton", "Conrad"] }),
      set("hyatt", "Hyatt", { brand_names: ["Hyatt", "Andaz"] }),
    ];
  });

  it("refuses associates and signed-out visitors", async () => {
    state.associate = { ...ADMIN, is_admin: false };
    expect((await change("hyatt", ["Hyatt", "Thompson"])).status).toBe(403);
    state.associate = null;
    expect((await change("hyatt", ["Hyatt", "Thompson"])).status).toBe(401);
    expect(listOf("hyatt")).toEqual(["Hyatt", "Andaz"]);
  });

  it("saves a new list, and records the list before and after", async () => {
    const res = await change("hyatt", ["Hyatt", "Andaz", "Thompson"]);

    expect(res.status).toBe(200);
    expect((await res.json()).brand_names).toEqual(["Hyatt", "Andaz", "Thompson"]);
    expect(listOf("hyatt")).toEqual(["Hyatt", "Andaz", "Thompson"]);
    expect(state.audit).toEqual([
      expect.objectContaining({
        actorId: ADMIN.id,
        action: "standard_set_brands_changed",
        metadata: { set_key: "hyatt", before: ["Hyatt", "Andaz"], after: ["Hyatt", "Andaz", "Thompson"] },
      }),
    ]);
  });

  it("tidies names, and keeps one entry for a brand written two ways", async () => {
    await change("hilton", ["Hilton", "  DoubleTree   by Hilton ", "doubletree", "", "Conrad"]);
    expect(listOf("hilton")).toEqual(["Hilton", "DoubleTree by Hilton", "Conrad"]);
  });

  it("refuses a brand another set already lists, and says which", async () => {
    const res = await change("hilton", ["Hilton", "Conrad", "Andaz"]);

    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("Andaz is already listed under Hyatt.");
    expect(listOf("hilton")).toEqual(["Hilton", "Conrad"]);
  });

  it("refuses another set's own name, and the default set's", async () => {
    expect((await (await change("hilton", ["Hilton", "Hyatt"])).json()).error).toBe("Hyatt is already listed under Hyatt.");
    expect((await (await change("hilton", ["Hilton", "Independent"])).json()).error).toBe(
      "Independent is the set for every other hotel, so it can't be listed."
    );
  });

  it("keeps the set's own name on its list, so the list is never empty", async () => {
    for (const names of [[], ["Conrad"]]) {
      const res = await change("hilton", names);
      expect(res.status).toBe(409);
      expect((await res.json()).error).toBe("Hilton is the set's own name, so it stays on the list.");
    }
    expect(listOf("hilton")).toEqual(["Hilton", "Conrad"]);
  });

  it("gives the default set no list", async () => {
    const res = await change("independent", ["Independent", "Boutique"]);

    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("Independent covers every hotel not listed under another set, so it has no list.");
    expect(listOf("independent")).toEqual([]);
  });

  it("needs a list of names, a sensible length, and a set that exists", async () => {
    expect((await change("hyatt", "Thompson")).status).toBe(400);
    expect((await change("hyatt", ["Hyatt", 7])).status).toBe(400);
    expect((await change("hyatt", ["Hyatt", "x".repeat(81)])).status).toBe(400);
    expect((await change("hyatt", ["Hyatt", ...Array.from({ length: 60 }, (_, i) => `Brand ${i}`)])).status).toBe(400);
    expect((await change("marriott", ["Marriott"])).status).toBe(404);
    expect(state.audit).toEqual([]);
  });

  it("leaves the switch alone when the list changes, and the list alone when the switch does", async () => {
    await change("hyatt", ["Hyatt", "Thompson"]);
    expect(state.tables.standard_sets.find((s) => s.key === "hyatt")).toMatchObject({ is_active: false, brand_names: ["Hyatt", "Thompson"] });

    state.tables.standards.push(standard("hyatt", "attrition"));
    await switchSet(json({ is_active: true }), params("hyatt"));
    expect(state.tables.standard_sets.find((s) => s.key === "hyatt")).toMatchObject({ is_active: true, brand_names: ["Hyatt", "Thompson"] });
  });
});
