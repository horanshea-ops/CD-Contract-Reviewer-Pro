import { describe, expect, it } from "vitest";
import type { AnalysisResult, Finding } from "@/lib/anthropic";
import { compareRuns } from "@/lib/eval/compare";
import { renderReport } from "@/lib/eval/report";
import { scoreRun } from "@/lib/eval/score";
import type { AnswerKey, KeyItem, RunRecord } from "@/lib/eval/types";

/**
 * Comparing a run with earlier runs of the same key.
 *
 * Three clauses, each missed by a different mix of runs, so every bucket the
 * comparison reports has exactly one item in it.
 */

const TEXT = [
  "Attrition applies below ninety percent (90%).",
  "Damages are a percentage of gross room revenue.",
  "Reservations close forty-five (45) days prior to arrival.",
].join("\n");

const CONTRACT = "c1.docx";
const documents = new Map([[CONTRACT, [{ part: "document", text: TEXT }]]]);

function item(id: string, clause_type: string, anchorText: string): KeyItem {
  const start = TEXT.indexOf(anchorText);
  return {
    id,
    contract: CONTRACT,
    kind: "present",
    clause_type,
    severity: "high",
    anchors: [{ part: "document", start, end: start + anchorText.length }],
    anchor_texts: [anchorText],
    expected_language: [],
    exposure: { mode: "unspecified" },
    rationale: "",
  };
}

const ITEMS = {
  attrition: item("k-attrition", "attrition", "Attrition applies below ninety percent (90%)."),
  cancellation: item("k-cancellation", "cancellation", "Damages are a percentage of gross room revenue."),
  cutoff: item("k-cutoff", "cutoff_date", "Reservations close forty-five (45) days prior to arrival."),
};

const KEY: AnswerKey = {
  version: "test-v1",
  source: "synthetic",
  standards_version: "v1",
  generated_at: "2026-09-23T00:00:00Z",
  contracts: [{ contract: CONTRACT, exhaustive: true, items: Object.values(ITEMS) }],
};

const findingFor = (k: KeyItem): Finding => ({
  clause_type: k.clause_type,
  is_missing_clause: false,
  severity: "high",
  location_section: null,
  quoted_text: k.anchor_texts[0],
  exposure_amount: null,
  exposure_basis: null,
  finding_text: "Unfavourable.",
  cd_standard: "CD position.",
  proposed_language: "Replacement wording.",
  model_confidence: "high",
});

function runFinding(run_id: string, found: KeyItem[]): RunRecord {
  const analysis: AnalysisResult = {
    findings: found.map(findingFor),
    clauses_checked: [],
    dropped_findings: [],
    document_notes: "",
    model_id: "claude-sonnet-5",
    standards_library_version: "v1",
    input_tokens: 0,
    output_tokens: 0,
    cache_read_input_tokens: 0,
    cache_creation_input_tokens: 0,
  };
  return {
    run_id,
    created_at: "2026-09-23T00:00:00Z",
    model_id: "claude-sonnet-5",
    standards_version: "v1",
    standards_hash: "abc",
    documents: [{ contract: CONTRACT, analysis, error: null, elapsed_ms: 0 }],
  };
}

const score = (r: RunRecord) => scoreRun({ key: KEY, run: r, documents });

// Both earlier runs miss attrition, and each misses one other clause.
const first = score(runFinding("first", [ITEMS.cutoff]));
const second = score(runFinding("second", [ITEMS.cancellation, ITEMS.cutoff]));

describe("compareRuns", () => {
  it("finds the misses every earlier run shares, and says whether this run caught them", () => {
    const current = score(runFinding("current", [ITEMS.attrition, ITEMS.cancellation]));
    const comparison = compareRuns(current, [first, second]);

    // Cancellation was missed only once, so it is chance rather than a blind spot.
    expect(comparison.repeat_misses).toEqual([
      { key_item_id: "k-attrition", contract: CONTRACT, clause_type: "attrition", severity: "high", caught_now: true },
    ]);
    // Every earlier run found the cutoff clause.
    expect(comparison.new_misses.map((m) => m.key_item_id)).toEqual(["k-cutoff"]);
    expect(comparison.baselines.map((b) => b.run_id)).toEqual(["first", "second"]);
    expect(comparison.current.matched).toBe(2);
  });

  it("marks a repeat miss this run also missed", () => {
    const current = score(runFinding("current", [ITEMS.cancellation, ITEMS.cutoff]));
    const comparison = compareRuns(current, [first, second]);
    expect(comparison.repeat_misses).toMatchObject([{ key_item_id: "k-attrition", caught_now: false }]);
    expect(comparison.new_misses).toEqual([]);
  });

  it("refuses baselines scored against a different key", () => {
    const current = score(runFinding("current", []));
    expect(() => compareRuns(current, [{ ...first, key_version: "other" }])).toThrow(/same answer key/);
  });

  it("renders the comparison in the report", () => {
    const current = score(runFinding("current", [ITEMS.attrition, ITEMS.cancellation]));
    const text = renderReport({ ...current, comparison: compareRuns(current, [first, second]) });

    expect(text).toContain("AGAINST EARLIER RUNS");
    expect(text).toContain("current (this run)");
    expect(text).toContain("Missed by every earlier run: 1. This run catches 1.");
    expect(text).toMatch(/caught {2}c1 +attrition +high/);
    expect(text).toContain("Found by every earlier run and missed now: 1.");
  });
});
