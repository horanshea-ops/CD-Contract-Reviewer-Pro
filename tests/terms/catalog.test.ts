import { describe, expect, it } from "vitest";
import { HOTEL_TERM_CATALOG, termGroup } from "@/lib/terms/catalog";
import { CD_POSITIONS } from "@/lib/eval/corpus/positions";
import { STANDARDS_LIBRARY } from "@/lib/standards/v1";

const terms = HOTEL_TERM_CATALOG.terms;
const byKey = new Map(terms.map((t) => [t.key, t]));

describe("the hotel term catalog", () => {
  it("has unique keys of the form group.field", () => {
    expect(new Set(terms.map((t) => t.key)).size).toBe(terms.length);
    for (const t of terms) expect(t.key).toMatch(/^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/);
  });

  it("groups every clause term under a clause type the standards library knows", () => {
    const clauseTypes = new Set(STANDARDS_LIBRARY.map((s) => s.clause_type));
    for (const t of terms) {
      const group = termGroup(t.key);
      if (group !== "deal") expect(clauseTypes, t.key).toContain(group);
    }
  });

  it("gives numbers a unit and nothing else one", () => {
    for (const t of terms) {
      if (t.kind === "number") expect(t.unit, t.key).toBeDefined();
      else expect(t.unit, t.key).toBeUndefined();
    }
  });

  it("gives enums at least two options and leaves 'other' implicit", () => {
    for (const t of terms.filter((t) => t.kind === "enum")) {
      const options = Object.keys(t.options ?? {});
      expect(options.length, t.key).toBeGreaterThanOrEqual(2);
      expect(options, t.key).not.toContain("other");
    }
  });

  it("says what both polarities of every boolean mean", () => {
    // A boolean defined only by its true case leaves silence and denial
    // indistinguishable, and silence must be omitted rather than recorded false.
    for (const t of terms.filter((t) => t.kind === "boolean")) {
      expect(t.meaning, t.key).toMatch(/^True when\b.+ False when\b.+/);
    }
  });
});

describe("the catalog against the eval corpus's fields", () => {
  // The eval specs are the answer key's ground truth. A field they carry that
  // the catalog lacks, or types differently, is a term the key cannot score.
  it("carries every checked field with the same kind and unit", () => {
    for (const position of CD_POSITIONS) {
      for (const check of position.checks) {
        const term = byKey.get(`${position.clause_type}.${check.field}`);
        expect(term, `${position.clause_type}.${check.field}`).toBeDefined();
        expect(term!.kind).toBe(check.kind);
        if (check.kind === "number") expect(term!.unit).toBe(check.unit);
        if (check.kind === "enum") {
          for (const allowed of check.allowed) expect(Object.keys(term!.options ?? {})).toContain(allowed);
        }
      }
    }
  });

  it("carries every stated-only field as a number in the unit its name gives", () => {
    for (const position of CD_POSITIONS) {
      for (const field of position.stated ?? []) {
        const term = byKey.get(`${position.clause_type}.${field}`);
        expect(term, `${position.clause_type}.${field}`).toBeDefined();
        expect(term!.kind).toBe("number");
        expect(term!.unit).toBe(field.endsWith("_usd") ? "usd" : "pct");
      }
    }
  });
});
