import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb, type Tables } from "./helpers/fake-db";
import { activeHref, navLinks } from "@/components/nav-links";

/**
 * Managing associates. The associates table is the sign-in allowlist, so
 * these routes decide who can use the app. Only admins reach them, an admin
 * can't lock themselves out, and one active admin always remains.
 */

const state = vi.hoisted(() => ({
  tables: {} as Record<string, Record<string, unknown>[]>,
  associate: null as null | { id: string; is_admin: boolean; name: string; email: string; signature_block: null },
  audit: [] as Record<string, unknown>[],
  authEmail: null as string | null,
}));

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => fakeDb(state.tables as Tables) }));
vi.mock("@/lib/audit", () => ({ logAudit: async (entry: Record<string, unknown>) => void state.audit.push(entry) }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: state.authEmail ? { email: state.authEmail } : null } }) } }),
}));

import { POST as add } from "@/app/api/admin/associates/route";
import { PATCH as edit } from "@/app/api/admin/associates/[id]/route";
import { getCurrentAssociate } from "@/lib/current-associate";

const person = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  name: id,
  email: `${id}@example.com`,
  is_admin: false,
  status: "active",
  signature_block: null,
  created_at: "2026-09-01",
  ...over,
});

const json = (body: unknown) =>
  new Request("http://localhost", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const params = (id: string) => ({ params: Promise.resolve({ id }) });

function signInAs(id: string) {
  state.authEmail = `${id}@example.com`;
}

beforeEach(() => {
  state.tables = { associates: [person("boss", { is_admin: true }), person("jo")] };
  state.audit = [];
  signInAs("boss");
});

describe("who can manage associates", () => {
  it("refuses associates and signed-out visitors", async () => {
    signInAs("jo");
    expect((await add(json({ name: "N", email: "n@example.com" }))).status).toBe(403);
    expect((await edit(json({ status: "revoked" }), params("boss"))).status).toBe(403);
    state.authEmail = null;
    expect((await add(json({ name: "N", email: "n@example.com" }))).status).toBe(401);
    expect(state.tables.associates).toHaveLength(2);
  });
});

describe("adding an associate", () => {
  it("adds an active row that lets the email sign in, and audits it", async () => {
    const res = await add(json({ name: "New Person", email: "  New@Example.com ", is_admin: false }));
    expect(res.status).toBe(201);
    expect(state.tables.associates.find((a) => a.email === "new@example.com")).toMatchObject({ status: "active", is_admin: false });
    expect(state.audit[0]).toMatchObject({ action: "associate_added" });

    state.authEmail = "new@example.com";
    expect(await getCurrentAssociate()).toMatchObject({ name: "New Person" });
  });

  it("refuses a duplicate email, and points a revoked one to Restore", async () => {
    expect((await add(json({ name: "J", email: "JO@example.com" }))).status).toBe(409);
    state.tables.associates[1].status = "revoked";
    const res = await add(json({ name: "J", email: "jo@example.com" }));
    expect((await res.json()).error).toMatch(/Restore their access/);
  });

  it("needs a name and a valid email", async () => {
    expect((await add(json({ name: "", email: "x@example.com" }))).status).toBe(400);
    expect((await add(json({ name: "X", email: "not-an-email" }))).status).toBe(400);
  });
});

describe("changing access", () => {
  it("revokes an associate, which stops their next request", async () => {
    expect((await edit(json({ status: "revoked" }), params("jo"))).status).toBe(200);
    signInAs("jo");
    expect(await getCurrentAssociate()).toBeNull();
  });

  it("won't let an admin revoke themselves or drop their own admin flag", async () => {
    state.tables.associates.push(person("second", { is_admin: true }));
    expect((await edit(json({ status: "revoked" }), params("boss"))).status).toBe(409);
    expect((await edit(json({ is_admin: false }), params("boss"))).status).toBe(409);
  });

  it("keeps one active admin", async () => {
    state.tables.associates.push(person("second", { is_admin: true }));
    signInAs("second");
    expect((await edit(json({ is_admin: false }), params("boss"))).status).toBe(200);
    // "second" is now the only admin, and can't remove themselves.
    expect((await edit(json({ is_admin: false }), params("second"))).status).toBe(409);
  });

  it("promotes an associate to admin and audits the change", async () => {
    expect((await edit(json({ is_admin: true }), params("jo"))).status).toBe(200);
    expect(state.audit[0]).toMatchObject({ action: "associate_updated", metadata: { changes: { is_admin: true } } });
  });
});

describe("the Admin nav link", () => {
  const admin = navLinks({ name: "A", email: "a@example.com", is_admin: true });

  it("shows only to admins, after Standards library", () => {
    expect(admin.map((l) => l.label).slice(-2)).toEqual(["Standards library", "Admin"]);
    expect(navLinks({ name: "A", email: "a@example.com", is_admin: false }).map((l) => l.label)).not.toContain("Admin");
  });

  it("lights up one link per page", () => {
    expect(activeHref("/admin/standards", admin)).toBe("/admin/standards");
    expect(activeHref("/admin/contracts", admin)).toBe("/admin/contracts");
    expect(activeHref("/admin/users", admin)).toBe("/admin/contracts");
    expect(activeHref("/", admin)).toBe("/");
    expect(activeHref("/analyses/123", admin)).toBeNull();
  });
});
