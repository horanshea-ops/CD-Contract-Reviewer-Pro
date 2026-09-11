import { describe, expect, it } from "vitest";
import { scoreTermsRun, sameValue } from "@/lib/eval/terms/score";
import { renderTermsReport } from "@/lib/eval/terms/report";
import type { TermsKey, TermsRunRecord } from "@/lib/eval/terms/types";
import type { StatedTerm, TermCatalog, Verification } from "@/lib/terms/types";

const CATALOG: TermCatalog = {
  version: "test-v1",
  terms: [
    { key: "a.pct", kind: "number", unit: "pct", meaning: "" },
    { key: "a.days", kind: "number", unit: "days", meaning: "" },
    { key: "a.flag", kind: "boolean", meaning: "" },
    { key: "a.basis", kind: "enum", options: { x: "", y: "" }, meaning: "" },
    { key: "a.gone", kind: "number", unit: "days", meaning: "" },
    { key: "a.gone2", kind: "boolean", meaning: "" },
    { key: "a.schedule", kind: "schedule", meaning: "" },
  ],
};

const stated = (term_key: string, value: StatedTerm["value"], verification: Verification = "verified"): StatedTerm => ({
  term_key,
  value,
  unit: null,
  quoted_text: "quote",
  source_section: null,
  confidence: "high",
  verification,
});

const key = (terms: TermsKey["contracts"][0]["terms"]): TermsKey => ({
  version: "k1",
  source: "hand",
  catalog_version: "test-v1",
  contracts: [{ contract: "c.docx", terms }],
});

const run = (terms: StatedTerm[]): TermsRunRecord => ({
  run_id: "r1",
  created_at: "2026-09-11T00:00:00Z",
  model_id: "m",
  catalog_version: "test-v1",
  documents: [
    {
      contract: "c.docx",
      terms: { catalog_version: "test-v1", stated: terms, not_stated: [], rejected: [], conflicts: [] },
      error: null,
      tokens: { input: 10, output: 5, cache_read: 0, cache_creation: 0 },
      elapsed_ms: 1,
    },
  ],
});

const outcomes = (k: TermsKey, r: TermsRunRecord) =>
  Object.fromEntries(
    scoreTermsRun({ key: k, run: r, catalog: CATALOG }).contracts[0].results.map((x) => [x.term_key, [x.outcome, x.silent_wrong]])
  );

describe("scoring term extraction", () => {
  it("names every outcome", () => {
    const k = key({ "a.pct": 0.9, "a.days": 30, "a.flag": true, "a.basis": "x", "a.gone": "not_stated", "a.gone2": "not_stated" });
    const r = run([
      stated("a.pct", 0.9),
      stated("a.days", 21),
      stated("a.days", 30),
      stated("a.basis", "y", "located"),
      stated("a.gone", 7, "unlocated"),
    ]);

    expect(outcomes(k, r)).toEqual({
      "a.pct": ["correct", false],
      "a.days": ["conflict", false],
      "a.flag": ["missed", false],
      "a.basis": ["wrong_value", true],
      "a.gone": ["invented", false],
      "a.gone2": ["correct_absent", false],
    });
  });

  it("calls a wrong value silent only when it passed verification", () => {
    const k = key({ "a.pct": 0.9, "a.days": 30, "a.gone": "not_stated" });
    const r = run([stated("a.pct", 0.85, "contradicted"), stated("a.days", 45, "verified"), stated("a.gone", 7, "located")]);

    expect(outcomes(k, r)).toEqual({
      "a.pct": ["wrong_value", false],
      "a.days": ["wrong_value", true],
      "a.gone": ["invented", true],
    });
  });

  it("compares schedules by band and percentage, not wording or order", () => {
    const a = [
      { label: "365 days or more", days_prior_min: 365, days_prior_max: null, pct: 0.25 },
      { label: "30 days or fewer", days_prior_min: 0, days_prior_max: 30, pct: 1 },
    ];
    const b = [
      { label: "Within 30 days", days_prior_min: 0, days_prior_max: 30, pct: 1 },
      { label: "More than a year out", days_prior_min: 365, days_prior_max: null, pct: 0.25 },
    ];
    expect(sameValue("schedule", a, b)).toBe(true);
    expect(sameValue("schedule", a, [{ ...b[0], pct: 0.9 }, b[1]])).toBe(false);
    expect(sameValue("schedule", a, [b[0]])).toBe(false);
  });

  it("counts a contract the run failed on as missing every value", () => {
    const k = key({ "a.pct": 0.9, "a.gone": "not_stated" });
    const r: TermsRunRecord = { ...run([]), documents: [{ contract: "c.docx", terms: null, error: "timeout", tokens: null, elapsed_ms: 0 }] };
    const report = scoreTermsRun({ key: k, run: r, catalog: CATALOG });

    expect(report.contracts[0].error).toBe("timeout");
    expect(report.tally).toMatchObject({ missed: 1, correct_absent: 1 });
  });

  it("refuses a key that scores a term the catalog does not have", () => {
    expect(() => scoreTermsRun({ key: key({ "a.nope": 1 }), run: run([]), catalog: CATALOG })).toThrow(/does not have/);
  });

  it("warns when key, run and catalog disagree on the catalog version", () => {
    const report = scoreTermsRun({ key: { ...key({}), catalog_version: "old-v0" }, run: run([]), catalog: CATALOG });
    expect(report.catalog_mismatch).toMatch(/old-v0/);
    expect(renderTermsReport(report)).toContain("WARNING");
  });

  it("puts silent-wrong first in the report and every non-correct term in the audit", () => {
    const k = key({ "a.days": 30 });
    const text = renderTermsReport(scoreTermsRun({ key: k, run: run([stated("a.days", 45)]), catalog: CATALOG }), { audit: true });

    expect(text).toMatch(/SILENT WRONG: 1/);
    expect(text).toMatch(/WRONG_VALUE \(SILENT\)\s+a\.days/);
    expect(text).toMatch(/expected 30/);
    expect(text).toMatch(/got\s+45\s+\[verified\]/);
  });
});
