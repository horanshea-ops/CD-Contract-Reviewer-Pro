import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb, type Tables } from "./helpers/fake-db";
import { clauseKey } from "@/lib/standards/keys";

/**
 * Editing the standards library: moving a standard between severities,
 * adding one, and removing one by retiring it. Every route is admin-only,
 * every change is audited, and a removed standard stops reaching the model.
 */

const state = vi.hoisted(() => ({
  tables: {} as Record<string, Record<string, unknown>[]>,
  associate: null as null | { id: string; is_admin: boolean; name: string; email: string; signature_block: null },
  audit: [] as Record<string, unknown>[],
}));

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => fakeDb(state.tables as Tables) }));
vi.mock("@/lib/current-associate", () => ({ getCurrentAssociate: async () => state.associate }));
vi.mock("@/lib/audit", () => ({ logAudit: async (entry: Record<string, unknown>) => void state.audit.push(entry) }));

import { POST as add } from "@/app/api/admin/standards/route";
import { DELETE as retire, PATCH as edit } from "@/app/api/admin/standards/[id]/route";
import { POST as restore } from "@/app/api/admin/standards/[id]/restore/route";
import { loadStandardsLibrary } from "@/lib/standards/load";

const ADMIN = { id: "admin-1", is_admin: true, name: "Admin", email: "a@example.com", signature_block: null };
const ASSOCIATE = { ...ADMIN, id: "assoc-1", is_admin: false };

function standard(clause_type: string, over: Record<string, unknown> = {}) {
  return {
    id: `std-${clause_type}`,
    clause_type,
    segment: "default",
    position: "p",
    fallback_language: "f",
    walk_away_condition: "",
    severity_default: "medium",
    version: "v1-industry-default",
    provenance: "industry_default",
    retired_at: null,
    ...over,
  };
}

const json = (body: unknown) =>
  new Request("http://localhost", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const params = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  state.tables = { standards: [standard("attrition"), standard("cutoff_date"), standard("old_clause", { retired_at: "2026-09-01" })] };
  state.associate = ADMIN;
  state.audit = [];
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://db");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "key");
});

describe("who can edit", () => {
  it("refuses associates and signed-out visitors on every route", async () => {
    for (const who of [ASSOCIATE, null]) {
      state.associate = who;
      const expected = who ? 403 : 401;
      expect((await add(json({}))).status).toBe(expected);
      expect((await edit(json({ severity_default: "high" }), params("std-attrition"))).status).toBe(expected);
      expect((await retire(json({}), params("std-attrition"))).status).toBe(expected);
      expect((await restore(json({}), params("std-old_clause"))).status).toBe(expected);
    }
    expect(state.tables.standards.find((s) => s.id === "std-attrition")!.severity_default).toBe("medium");
  });
});

describe("moving a standard between severities", () => {
  it("saves the new severity and audits it", async () => {
    const res = await edit(json({ severity_default: "high" }), params("std-attrition"));
    expect(res.status).toBe(200);
    expect(state.tables.standards.find((s) => s.id === "std-attrition")!.severity_default).toBe("high");
    expect(state.audit[0]).toMatchObject({ action: "standard_updated", metadata: { severity_default: "high" } });
  });

  it("refuses a severity that doesn't exist", async () => {
    expect((await edit(json({ severity_default: "urgent" }), params("std-attrition"))).status).toBe(400);
  });
});

describe("adding a standard", () => {
  it("keys the clause from its name and marks it validated by the admin", async () => {
    const res = await add(json({ name: "Late Checkout & Early Departure", position: "p", fallback_language: "f", severity_default: "low" }));
    expect(res.status).toBe(201);
    const row = state.tables.standards.find((s) => s.clause_type === "late_checkout_and_early_departure")!;
    expect(row).toMatchObject({ provenance: "cd_validated", validated_by: ADMIN.id, segment: "default", version: "v1-industry-default" });
    expect(state.audit[0]).toMatchObject({ action: "standard_added" });
  });

  it("refuses a name already in the library, and points a removed one to Restore", async () => {
    const taken = await add(json({ name: "Attrition", position: "p", fallback_language: "f", severity_default: "high" }));
    expect(taken.status).toBe(409);
    const removed = await add(json({ name: "Old clause", position: "p", fallback_language: "f", severity_default: "high" }));
    expect((await removed.json()).error).toMatch(/Restore it/);
  });

  it("needs a name, position, fallback language and severity", async () => {
    expect((await add(json({ name: "X", position: "", fallback_language: "f", severity_default: "high" }))).status).toBe(400);
    expect((await add(json({ name: "X", position: "p", fallback_language: "f" }))).status).toBe(400);
  });

  it("turns typed names into clause keys", () => {
    expect(clauseKey("  Wi-Fi / Internet  ")).toBe("wi_fi_internet");
  });
});

describe("removing a standard", () => {
  it("retires it, keeps the row, and leaves it out of what the model reads", async () => {
    expect((await retire(json({}), params("std-attrition"))).status).toBe(200);
    const row = state.tables.standards.find((s) => s.id === "std-attrition")!;
    expect(row.retired_at).toBeTruthy();
    expect(row.retired_by).toBe(ADMIN.id);

    const loaded = await loadStandardsLibrary();
    expect(loaded.entries.map((e) => e.clause_type)).toEqual(["cutoff_date"]);
  });

  it("restores it", async () => {
    expect((await restore(json({}), params("std-old_clause"))).status).toBe(200);
    const loaded = await loadStandardsLibrary();
    expect(loaded.entries.map((e) => e.clause_type)).toContain("old_clause");
    expect(state.audit.map((a) => a.action)).toEqual(["standard_restored"]);
  });

  it("keeps at least one standard in the library", async () => {
    await retire(json({}), params("std-attrition"));
    expect((await retire(json({}), params("std-cutoff_date"))).status).toBe(409);
  });
});
