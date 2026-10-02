import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb, type Tables } from "./helpers/fake-db";

/**
 * Deciding a finding. A legal finding takes no wording, because CD gives no
 * legal advice, so the route refuses an edit on one whatever the screen shows.
 */

const state = vi.hoisted(() => ({
  tables: {} as Record<string, Record<string, unknown>[]>,
  associate: null as null | { id: string; is_admin: boolean },
}));

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => fakeDb(state.tables as Tables) }));
vi.mock("@/lib/current-associate", () => ({ getCurrentAssociate: async () => state.associate }));
vi.mock("@/lib/audit", () => ({ logAudit: async () => {} }));

import { POST } from "@/app/api/findings/[id]/actions/route";

// The fake database has no joins, so each finding carries its analysis inline.
const finding = (id: string, category: string) => ({
  id,
  analysis_id: "analysis-1",
  category,
  analyses: { associate_id: "assoc-1" },
});

const act = (id: string, body: unknown) =>
  POST(
    new Request("http://localhost", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
    { params: Promise.resolve({ id }) }
  );

beforeEach(() => {
  state.tables = { findings: [finding("f-legal", "legal"), finding("f-business", "business")], finding_actions: [] };
  state.associate = { id: "assoc-1", is_admin: false };
});

describe("deciding a legal finding", () => {
  it("refuses an edit, so no wording is ever stored against it", async () => {
    const res = await act("f-legal", { action: "edit", editedLanguage: "Governed by Group's state law." });
    expect(res.status).toBe(400);
    expect(state.tables.finding_actions).toEqual([]);
  });

  it("records a flag for the client as an accept, and a dismissal", async () => {
    expect((await act("f-legal", { action: "accept" })).status).toBe(200);
    expect((await act("f-legal", { action: "dismiss", dismissalReason: "Client accepted this risk" })).status).toBe(200);
    expect(state.tables.finding_actions.map((a) => a.action)).toEqual(["accept", "dismiss"]);
  });

  it("still lets a business finding be edited", async () => {
    expect((await act("f-business", { action: "edit", editedLanguage: "Seventy percent (70%)." })).status).toBe(200);
  });
});
