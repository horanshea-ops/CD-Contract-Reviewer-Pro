import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb, type Tables } from "./helpers/fake-db";

/**
 * Standards sets by hotel brand (CLAUDE.md deviation 10).
 *
 * A review reads one set and nothing from any other. A set that is switched
 * off, empty or unknown gives the default set, and the review records why, so
 * a contract is never judged against a half-built library without anyone
 * being told.
 */

const state = vi.hoisted(() => ({ tables: {} as Record<string, Record<string, unknown>[]>, failures: 0 }));

/** A database whose every read comes back with an error. */
function failingDb(message: string) {
  const result = { data: null, error: { message } };
  const query: Record<string, unknown> = { select: () => query, is: () => query, then: (done: (r: typeof result) => unknown) => done(result) };
  return { from: () => query };
}

// The first `state.failures` clients fail every read. The rest read the tables.
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => (state.failures-- > 0 ? failingDb("JWT issued at future") : fakeDb(state.tables as Tables)),
}));

import { hashStandards, loadStandardsLibrary, StandardsUnreadableError } from "@/lib/standards/load";
import { STANDARDS_LIBRARY } from "@/lib/standards/v1";

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
  set_key,
  clause_type,
  segment: "default",
  category: "business",
  position: `${set_key} position on ${clause_type}.`,
  fallback_language: `${set_key} wording for ${clause_type}.`,
  walk_away_condition: "",
  severity_default: "high",
  compromise_range: "",
  version: "v1-industry-default",
  provenance: "extracted",
  retired_at: null,
  ...over,
});

beforeEach(() => {
  state.failures = 0;
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://localhost");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "test-key");
  state.tables = {
    standard_sets: [
      set("independent", "Independent", { is_default: true, is_active: true }),
      set("hilton", "Hilton", { is_active: true }),
      set("hyatt", "Hyatt"),
    ],
    standards: [
      standard("independent", "attrition"),
      standard("independent", "cancellation"),
      standard("independent", "commission", { retired_at: "2026-10-01T00:00:00Z" }),
      standard("hilton", "attrition"),
      standard("hyatt", "attrition"),
    ],
  };
});

describe("loading a set", () => {
  it("reads Independent when no set is named, leaving out retired standards", async () => {
    const loaded = await loadStandardsLibrary();

    expect(loaded).toMatchObject({ source: "database", set: "independent", requestedSet: "independent" });
    expect(loaded.setNote).toBeUndefined();
    expect(loaded.entries.map((e) => e.clause_type).sort()).toEqual(["attrition", "cancellation"]);
    expect(loaded.entries.every((e) => e.position.startsWith("independent"))).toBe(true);
  });

  it("reads only the named set's standards", async () => {
    const loaded = await loadStandardsLibrary("hilton");

    expect(loaded).toMatchObject({ set: "hilton", requestedSet: "hilton" });
    expect(loaded.setNote).toBeUndefined();
    expect(loaded.entries.map((e) => e.position)).toEqual(["hilton position on attrition."]);
  });

  it("fingerprints a set by its contents alone, so Independent's fingerprint is what it was before sets", async () => {
    state.tables.standards = STANDARDS_LIBRARY.map((e) => ({ ...e, set_key: "independent", retired_at: null }));
    const loaded = await loadStandardsLibrary();

    expect(loaded.entries).toHaveLength(STANDARDS_LIBRARY.length);
    expect(loaded.hash).toBe(hashStandards(STANDARDS_LIBRARY));
    // The set's key is no part of an entry sent to the model.
    expect(loaded.entries[0]).not.toHaveProperty("set_key");
  });
});

describe("a set that can't be used", () => {
  it("gives Independent for a set that is switched off, and says so", async () => {
    const loaded = await loadStandardsLibrary("hyatt");

    expect(loaded).toMatchObject({ set: "independent", requestedSet: "hyatt" });
    expect(loaded.setNote).toBe("Hyatt's standards are switched off, so this review used Independent.");
    expect(loaded.entries.every((e) => e.position.startsWith("independent"))).toBe(true);
  });

  it("gives Independent for a set with no standards yet", async () => {
    state.tables.standards = state.tables.standards.filter((s) => s.set_key !== "hilton");
    const loaded = await loadStandardsLibrary("hilton");

    expect(loaded).toMatchObject({ set: "independent", requestedSet: "hilton" });
    expect(loaded.setNote).toBe("Hilton has no standards yet, so this review used Independent.");
  });

  it("gives Independent for a set whose standards are all retired", async () => {
    for (const s of state.tables.standards) if (s.set_key === "hilton") s.retired_at = "2026-10-02T00:00:00Z";
    expect(await loadStandardsLibrary("hilton")).toMatchObject({ set: "independent", requestedSet: "hilton" });
  });

  it("gives Independent for a set nobody has created", async () => {
    const loaded = await loadStandardsLibrary("marriott");

    expect(loaded).toMatchObject({ set: "independent", requestedSet: "marriott" });
    expect(loaded.setNote).toBe("There is no standards set called marriott, so this review used Independent.");
  });

  it("falls back to the bundled copy when Independent itself is empty, as before", async () => {
    state.tables.standards = [];
    const loaded = await loadStandardsLibrary();

    expect(loaded).toMatchObject({ source: "bundled_fallback", set: "independent" });
    expect(loaded.entries).toBe(STANDARDS_LIBRARY);
  });

  it("uses the bundled copy with no database, which headless scripts rely on", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    const loaded = await loadStandardsLibrary("hilton");

    expect(loaded).toMatchObject({ source: "bundled_fallback", set: "independent", requestedSet: "hilton" });
    expect(loaded.setNote).toMatch(/used Independent/);
  });
});

describe("a database that can't be read", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /** Runs a load to its end, past the waits between tries. */
  async function settle<T>(load: Promise<T>): Promise<T> {
    const outcome = load.then(
      (value) => ({ value }),
      (error: unknown) => ({ error })
    );
    await vi.runAllTimersAsync();
    const result = await outcome;
    if ("error" in result) throw result.error;
    return result.value;
  }

  it("reads the database on a later try when the first read fails", async () => {
    state.failures = 2;
    const loaded = await settle(loadStandardsLibrary());

    expect(loaded).toMatchObject({ source: "database", set: "independent" });
    expect(loaded.fallbackReason).toBeUndefined();
  });

  it("fails after three tries, and never reviews against the bundled copy", async () => {
    state.failures = 3;
    const load = settle(loadStandardsLibrary());

    await expect(load).rejects.toBeInstanceOf(StandardsUnreadableError);
    await expect(load).rejects.toThrow(/couldn't be read, so nothing was reviewed \(could not read the standards sets: JWT issued at future\)/);
  });
});
