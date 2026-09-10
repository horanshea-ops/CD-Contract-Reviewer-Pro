import { describe, it, expect } from "vitest";
import { STANDARDS_LIBRARY } from "@/lib/standards/v1";
import { CD_POSITIONS, POSITION_BY_CLAUSE, clauseFields } from "@/lib/eval/corpus/positions";
import { deriveKeyItems, checkPasses } from "@/lib/eval/corpus/derive-key";
import { EVAL_SPECS } from "@/lib/eval/corpus/specs";
import type { EvalContractSpec, TermCheck } from "@/lib/eval/corpus/spec";

/**
 * The key is only ground truth if the spec it derives from is complete and the
 * positions it is checked against match the library the model is handed. Both
 * are asserted here rather than assumed, because a drifted position produces a
 * key that is confidently wrong and reads exactly like a correct one.
 */

const library = STANDARDS_LIBRARY;

describe("CD_POSITIONS", () => {
  it("covers every clause type in the standards library, and no others", () => {
    const inLibrary = new Set(library.map((e) => e.clause_type as string));
    const transcribed = new Set(CD_POSITIONS.map((p) => p.clause_type));

    expect([...inLibrary].filter((c) => !transcribed.has(c))).toEqual([]);
    expect([...transcribed].filter((c) => !inLibrary.has(c))).toEqual([]);
  });

  it("declares each clause type once", () => {
    expect(new Set(CD_POSITIONS.map((p) => p.clause_type)).size).toBe(CD_POSITIONS.length);
  });

  it("never restates severity, so the library stays the only source of it", async () => {
    const source = await import("node:fs/promises").then((fs) =>
      fs.readFile("lib/eval/corpus/positions.ts", "utf8")
    );
    // Comments stripped — the file's own doc comment explains this rule, and
    // matching prose would flag the explanation as the violation.
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(code).not.toMatch(/severity/i);
  });

  it("gives every check a distinct field within its clause", () => {
    for (const position of CD_POSITIONS) {
      const fields = clauseFields(position.clause_type);
      expect(new Set(fields).size, `${position.clause_type} repeats a field`).toBe(fields.length);
    }
  });
});

describe("checkPasses", () => {
  const num = (comparator: "lte" | "lt" | "eq" | "gte" | "gt", value: number) =>
    ({ field: "f", label: "f", kind: "number", comparator, value, unit: "pct" }) as const;

  it("compares numbers on the stated side of the bound", () => {
    expect(checkPasses(num("lte", 0.7), 0.7)).toBe(true);
    expect(checkPasses(num("lte", 0.7), 0.71)).toBe(false);
    expect(checkPasses(num("lt", 0.7), 0.7)).toBe(false);
    expect(checkPasses(num("gte", 12), 12)).toBe(true);
    expect(checkPasses(num("gte", 12), 11)).toBe(false);
    expect(checkPasses(num("gt", 12), 12)).toBe(false);
    expect(checkPasses(num("eq", 5), 5)).toBe(true);
  });

  it("fails a number check given a non-number, rather than coercing", () => {
    expect(checkPasses(num("lte", 0.7), "0.5" as never)).toBe(false);
    expect(checkPasses(num("lte", 0.7), true)).toBe(false);
  });

  it("compares enums and booleans by identity", () => {
    const e: TermCheck = { field: "f", label: "f", kind: "enum", allowed: ["cumulative"] };
    expect(checkPasses(e, "cumulative")).toBe(true);
    expect(checkPasses(e, "night_by_night")).toBe(false);

    const b: TermCheck = { field: "f", label: "f", kind: "boolean", expected: false };
    expect(checkPasses(b, false)).toBe(true);
    expect(checkPasses(b, true)).toBe(false);
  });
});

describe("deriveKeyItems", () => {
  it("keys nothing when every term meets CD's position", () => {
    // eval-03 is compliant apart from two deliberate marginal terms, so
    // stripping those must leave a contract with no findings at all. If this
    // fails, the "compliant" profile is not compliant and every false-positive
    // number in the report is measured against a corpus that was never clean.
    const spec = EVAL_SPECS.find((s) => s.id === "eval-03-bayfront")!;
    const clean: EvalContractSpec = {
      ...spec,
      terms: {
        ...spec.terms,
        attrition: { ...(spec.terms.attrition as Record<string, never>), threshold: 0.7 },
        cutoff_date: { ...(spec.terms.cutoff_date as Record<string, never>), days_prior: 30 },
      },
    };
    expect(deriveKeyItems(clean, library)).toEqual([]);
  });

  it("keys exactly the two marginal terms eval-03 declares", () => {
    const spec = EVAL_SPECS.find((s) => s.id === "eval-03-bayfront")!;
    const items = deriveKeyItems(spec, library);

    expect(items.map((i) => i.clause_type)).toEqual(["attrition", "cutoff_date"]);
    expect(items[0].kind).toBe("present");
    expect(items[0].anchor_field).toBe("threshold");
    expect(items[0].failed_fields).toEqual(["threshold"]);
    expect(items[0].severity).toBe("high"); // read from the library, not restated
    expect(items[1].severity).toBe("medium");
  });

  it("anchors on the first failing check, not the first field", () => {
    const spec = EVAL_SPECS.find((s) => s.id === "eval-15-vantage")!;
    const attrition = deriveKeyItems(spec, library).find((i) => i.clause_type === "attrition")!;

    // basis passes here only in eval-15's sibling contracts; here it fails
    // first, so it is the anchor even though threshold also fails.
    expect(attrition.failed_fields).toEqual(["basis", "threshold", "high_occupancy_credit"]);
    expect(attrition.anchor_field).toBe("basis");
  });

  it("keys an absent clause with no anchor and every check unmet", () => {
    const spec = EVAL_SPECS.find((s) => s.id === "eval-05-riverwalk")!;
    const storm = deriveKeyItems(spec, library).find((i) => i.clause_type === "named_storm")!;

    expect(storm.kind).toBe("absent");
    expect(storm.anchor_field).toBeNull();
    expect(storm.failed_fields).toEqual(POSITION_BY_CLAUSE.get("named_storm")!.checks.map((c) => c.field));
  });

  it("produces one item per deviating clause, never one per failing check", () => {
    const spec = EVAL_SPECS.find((s) => s.id === "eval-01-harborview")!;
    const items = deriveKeyItems(spec, library);
    expect(new Set(items.map((i) => i.clause_type)).size).toBe(items.length);
    expect(items.some((i) => i.failed_fields.length > 1)).toBe(true);
  });

  it("is deterministic", () => {
    for (const spec of EVAL_SPECS) {
      expect(deriveKeyItems(spec, library)).toEqual(deriveKeyItems(spec, library));
    }
  });

  it("rejects a clause whose fields do not match its position", () => {
    const spec = EVAL_SPECS[0];
    const typo: EvalContractSpec = {
      ...spec,
      terms: { ...spec.terms, cutoff_date: { days_prior: 45, post_cutoff_rate: false } },
    };
    expect(() => deriveKeyItems(typo, library)).toThrow(/missing field\(s\) post_cutoff_group_rate/);
    expect(() => deriveKeyItems(typo, library)).toThrow(/unknown field\(s\) post_cutoff_rate/);
  });

  it("rejects a spec that leaves a clause type undeclared", () => {
    const spec = EVAL_SPECS[0];
    const terms = { ...spec.terms };
    delete terms.rate_parity;
    expect(() => deriveKeyItems({ ...spec, terms }, library)).toThrow(/Missing: rate_parity/);
  });

  it("marks a disclosed resort fee as the one exposure the contract computes", () => {
    const spec = EVAL_SPECS.find((s) => s.id === "eval-13-northstar")!;
    const fees = deriveKeyItems(spec, library).find((i) => i.clause_type === "mandatory_fees")!;

    expect(fees.exposure.mode).toBe("required");
    expect(fees.exposure.amount).toBe(42 * 400 * 4);
  });

  it("takes no exposure position where no single-step figure exists", () => {
    const spec = EVAL_SPECS.find((s) => s.id === "eval-01-harborview")!;
    const items = deriveKeyItems(spec, library);
    expect(items.find((i) => i.clause_type === "attrition")!.exposure.mode).toBe("unspecified");
    expect(items.find((i) => i.clause_type === "governing_law_venue")!.exposure.mode).toBe("forbidden");
  });

  it("asserts language only where the assertion is predictable", () => {
    const spec = EVAL_SPECS.find((s) => s.id === "eval-01-harborview")!;
    const items = deriveKeyItems(spec, library);

    const attrition = items.find((i) => i.clause_type === "attrition")!;
    expect(attrition.expected_language).toContainEqual({ kind: "contains_phrase", phrase: "cumulative" });
    expect(attrition.expected_language).toContainEqual({ kind: "absent_phrase", phrase: "night-by-night" });
    expect(attrition.expected_language).toContainEqual({
      kind: "numeric_bound",
      label: "attrition threshold",
      unit: "pct",
      comparator: "lte",
      value: 0.7,
    });

    // walk_relocation fails only boolean checks, which produce no assertion.
    const walk = items.find((i) => i.clause_type === "walk_relocation")!;
    expect(walk.expected_language).toEqual([]);
  });

  it("writes a rationale naming the term and CD's position", () => {
    const spec = EVAL_SPECS.find((s) => s.id === "eval-07-monarch")!;
    const cutoff = deriveKeyItems(spec, library).find((i) => i.clause_type === "cutoff_date")!;
    expect(cutoff.rationale).toBe("room block cutoff date is 32, and CD's position is at most 30 days.");
  });
});

describe("the corpus as a whole", () => {
  const derived = EVAL_SPECS.map((spec) => ({ spec, items: deriveKeyItems(spec, library) }));

  it("has fifteen contracts with unique ids", () => {
    expect(EVAL_SPECS).toHaveLength(15);
    expect(new Set(EVAL_SPECS.map((s) => s.id)).size).toBe(15);
  });

  it("gives every key item a unique id", () => {
    const ids = derived.flatMap((d) => d.items.map((i) => i.id));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("keys enough items for a per-clause breakdown to mean anything", () => {
    const total = derived.reduce((n, d) => n + d.items.length, 0);
    expect(total).toBeGreaterThanOrEqual(120);
  });

  it("exercises every clause type at least once as a finding", () => {
    const keyed = new Set(derived.flatMap((d) => d.items.map((i) => i.clause_type)));
    const missing = CD_POSITIONS.map((p) => p.clause_type).filter((c) => !keyed.has(c));
    expect(missing).toEqual([]);
  });

  it("leaves every clause type compliant in at least one contract", () => {
    // Without this, a clause type is adverse everywhere it appears and the
    // corpus cannot tell a model that reads from a model that always objects.
    for (const { clause_type } of CD_POSITIONS) {
      const compliantSomewhere = derived.some(
        ({ spec, items }) =>
          spec.terms[clause_type] !== "absent" && !items.some((i) => i.clause_type === clause_type)
      );
      expect(compliantSomewhere, `${clause_type} is never compliant anywhere in the corpus`).toBe(true);
    }
  });

  it("covers both key item kinds and every severity band", () => {
    const items = derived.flatMap((d) => d.items);
    expect(items.some((i) => i.kind === "present")).toBe(true);
    expect(items.filter((i) => i.kind === "absent").length).toBeGreaterThanOrEqual(15);
    for (const severity of ["high", "medium", "low"] as const) {
      expect(items.some((i) => i.severity === severity), `no ${severity} items`).toBe(true);
    }
  });

  it("keeps at least one contract nearly clean, so false positives are measurable", () => {
    const cleanest = Math.min(...derived.map((d) => d.items.length));
    expect(cleanest).toBeLessThanOrEqual(3);
  });
});
