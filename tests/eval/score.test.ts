import { describe, it, expect } from "vitest";
import type { AnalysisResult, Finding } from "@/lib/anthropic";
import type { AnswerKey, KeyItem, RunRecord } from "@/lib/eval/types";
import { scoreRun } from "@/lib/eval/score";
import { renderReport } from "@/lib/eval/report";

/**
 * Scoring end to end, on documents small enough to reason about by hand.
 *
 * Every case here is one a real run produces and a naive scorer gets wrong —
 * one finding standing in for two issues, two findings splitting one, a quote
 * that is not in the document, a key that does not claim to be exhaustive.
 */

const TEXT = [
  "# 1. Attrition",
  "Attrition is measured night-by-night. The threshold is ninety percent (90%).",
  "# 2. Cancellation",
  "Damages are a percentage of gross room revenue.",
  "# 3. Cutoff",
  "Reservations close forty-five (45) days prior to arrival.",
].join("\n");

const CONTRACT = "c1.docx";
const documents = new Map([[CONTRACT, [{ part: "document", text: TEXT }]]]);

const spanOf = (needle: string) => {
  const start = TEXT.indexOf(needle);
  if (start === -1) throw new Error(`fixture lacks ${needle}`);
  return { part: "document", start, end: start + needle.length };
};

function item(id: string, clause_type: string, anchorText: string | null, over: Partial<KeyItem> = {}): KeyItem {
  return {
    id,
    contract: CONTRACT,
    kind: anchorText ? "present" : "absent",
    clause_type,
    severity: "high",
    anchors: anchorText ? [spanOf(anchorText)] : [],
    anchor_texts: anchorText ? [anchorText] : [],
    expected_language: [],
    exposure: { mode: "unspecified" },
    rationale: "",
    ...over,
  };
}

const ATTRITION = item("k-attrition", "attrition", "The threshold is ninety percent (90%).");
const CANCELLATION = item("k-cancellation", "cancellation", "Damages are a percentage of gross room revenue.", {
  severity: "medium",
});
const CUTOFF = item("k-cutoff", "cutoff_date", "Reservations close forty-five (45) days prior to arrival.", {
  severity: "low",
});

function finding(over: Partial<Finding> = {}): Finding {
  return {
    clause_type: "attrition",
    is_missing_clause: false,
    severity: "high",
    location_section: null,
    quoted_text: "The threshold is ninety percent (90%).",
    exposure_amount: null,
    exposure_basis: null,
    finding_text: "Too high.",
    cd_standard: "70%.",
    proposed_language: "Liability applies below seventy percent (70%).",
    model_confidence: "high",
    ...over,
  };
}

function analysis(findings: Finding[], clauses_checked: string[] = []): AnalysisResult {
  return {
    findings,
    clauses_checked,
    document_notes: "",
    model_id: "claude-sonnet-5",
    standards_library_version: "v1",
    input_tokens: 100,
    output_tokens: 50,
    cache_read_input_tokens: 10,
    cache_creation_input_tokens: 0,
  };
}

function key(items: KeyItem[], exhaustive = true): AnswerKey {
  return {
    version: "test-v1",
    source: "synthetic",
    standards_version: "v1",
    generated_at: "2026-09-09T00:00:00Z",
    contracts: [{ contract: CONTRACT, exhaustive, items }],
  };
}

function run(findings: Finding[], clauses_checked: string[] = []): RunRecord {
  return {
    run_id: "r1",
    created_at: "2026-09-09T00:00:00Z",
    model_id: "claude-sonnet-5",
    standards_version: "v1",
    standards_hash: "abc",
    documents: [{ contract: CONTRACT, analysis: analysis(findings, clauses_checked), error: null, elapsed_ms: 1000 }],
  };
}

const score = (k: AnswerKey, r: RunRecord) => scoreRun({ key: k, run: r, documents });

describe("scoreRun", () => {
  it("scores a run that found everything, correctly", () => {
    const report = score(
      key([ATTRITION, CANCELLATION]),
      run([
        finding(),
        finding({
          clause_type: "cancellation",
          severity: "medium",
          quoted_text: "Damages are a percentage of gross room revenue.",
        }),
      ])
    );

    expect(report.detection.matched).toBe(2);
    expect(report.detection.recall).toBe(1);
    expect(report.detection.precision).toBe(1);
    expect(report.weighted_recall).toBe(1);
    expect(report.attributes.clause_type_correct).toBe(2);
    expect(report.attributes.severity_exact).toBe(2);
    expect(report.attributes.quote.exact).toBe(2);
  });

  it("counts a clause nobody looked at as missed, and an invention as spurious", () => {
    const report = score(
      key([ATTRITION, CANCELLATION]),
      run([finding({ clause_type: "named_storm", quoted_text: "wording that is nowhere in this document" })])
    );

    expect(report.detection.matched).toBe(0);
    expect(report.detection.missed).toBe(2);
    expect(report.detection.spurious).toBe(1);
    expect(report.detection.recall).toBe(0);
    expect(report.detection.precision).toBe(0);
  });

  it("separates a swallowed key item from one nobody noticed", () => {
    // One finding quoting the whole document covers both issues, but carries one
    // severity and one replacement where two were needed.
    const broad = finding({ quoted_text: TEXT });
    const report = score(key([ATTRITION, CANCELLATION]), run([broad]));

    expect(report.detection.matched).toBe(1);
    expect(report.detection.conflated).toBe(1);
    expect(report.detection.missed).toBe(0);
  });

  it("separates a second finding on one issue from an invented one", () => {
    const report = score(
      key([ATTRITION]),
      run([finding(), finding({ finding_text: "Also too high.", quoted_text: "ninety percent (90%)" })])
    );

    expect(report.detection.matched).toBe(1);
    expect(report.detection.duplicates).toBe(1);
    expect(report.detection.spurious).toBe(0);
    expect(report.detection.precision).toBe(0.5);
  });

  it("leaves findings unjudged when the key does not claim to be exhaustive", () => {
    // A reviewer's key was never asked to list everything, so an extra finding
    // there is unjudged rather than wrong — and must not drag precision down.
    const report = score(
      key([ATTRITION], false),
      run([finding(), finding({ clause_type: "named_storm", quoted_text: "not in this document" })])
    );

    expect(report.detection.matched).toBe(1);
    expect(report.detection.spurious).toBe(0);
    expect(report.detection.unscored).toBe(1);
    expect(report.detection.precision).toBe(1);
  });

  it("weights recall so a missed high-severity item costs more than a missed note", () => {
    const foundHigh = score(key([ATTRITION, CUTOFF]), run([finding()]));
    const foundLow = score(
      key([ATTRITION, CUTOFF]),
      run([
        finding({
          clause_type: "cutoff_date",
          severity: "low",
          quoted_text: "Reservations close forty-five (45) days prior to arrival.",
        }),
      ])
    );

    expect(foundHigh.detection.recall).toBe(foundLow.detection.recall);
    expect(foundHigh.weighted_recall).toBeGreaterThan(foundLow.weighted_recall);
  });

  it("breaks recall out by severity band", () => {
    const report = score(key([ATTRITION, CANCELLATION, CUTOFF]), run([finding()]));
    const bands = Object.fromEntries(report.by_severity.map((r) => [r.severity, r.recall]));

    expect(bands.high).toBe(1);
    expect(bands.medium).toBe(0);
    expect(bands.low).toBe(0);
  });

  it("records a wrong clause name as a wrong name, not as a miss and an invention", () => {
    const report = score(key([ATTRITION]), run([finding({ clause_type: "force_majeure" })]));

    expect(report.detection.matched).toBe(1);
    expect(report.detection.missed).toBe(0);
    expect(report.detection.spurious).toBe(0);
    expect(report.attributes.clause_type_correct).toBe(0);
  });

  it("records a fabricated quote on an otherwise correct finding", () => {
    const report = score(
      key([ATTRITION]),
      run([finding({ quoted_text: "a sentence this contract does not contain anywhere" })])
    );

    expect(report.detection.matched).toBe(1);
    expect(report.attributes.quote.unlocatable).toBe(1);
  });

  it("fills the severity confusion matrix by what the key expected", () => {
    const report = score(key([ATTRITION]), run([finding({ severity: "note" })]));
    expect(report.attributes.severity_confusion.high.note).toBe(1);
    expect(report.attributes.severity_under_called).toBe(1);
  });

  it("names the clause types the run never said it checked", () => {
    const report = score(key([ATTRITION, CANCELLATION]), run([finding()], ["Attrition Clause"]));
    expect(report.contracts[0].coverage.not_checked).toEqual(["cancellation"]);
  });

  it("counts every item in a failed contract as missed, not as absent", () => {
    // A pipeline that cannot read a document finds nothing in it. That is a
    // result, not the absence of one.
    const failed: RunRecord = {
      ...run([]),
      documents: [{ contract: CONTRACT, analysis: null, error: "extraction failed", elapsed_ms: 0 }],
    };
    const report = scoreRun({ key: key([ATTRITION, CANCELLATION]), run: failed, documents });

    expect(report.detection.missed).toBe(2);
    expect(report.detection.recall).toBe(0);
    expect(report.contracts[0].error).toBe("extraction failed");
  });

  it("states it when the run and the key were built against different libraries", () => {
    const mismatched: RunRecord = { ...run([finding()]), standards_version: "v2" };
    const report = scoreRun({ key: key([ATTRITION]), run: mismatched, documents });
    expect(report.standards_mismatch).toContain("v1");
    expect(report.standards_mismatch).toContain("v2");
  });

  it("refuses to score a contract whose text it was not given", () => {
    expect(() => scoreRun({ key: key([ATTRITION]), run: run([finding()]), documents: new Map() })).toThrow(
      /re-extracts the DOCX/
    );
  });
});

describe("renderReport", () => {
  const report = score(
    key([ATTRITION, CANCELLATION, CUTOFF]),
    run([finding(), finding({ clause_type: "named_storm", quoted_text: "not present here at all" })], ["attrition"])
  );

  it("prints the buckets behind every rate, so the rates can be recomputed", () => {
    const text = renderReport(report);
    for (const label of ["Key items", "Matched", "Missed", "Conflated", "Duplicates", "Spurious", "Unscored"]) {
      expect(text).toContain(label);
    }
    expect(text).toContain("RECALL BY SEVERITY");
    expect(text).toContain("BY CLAUSE TYPE");
  });

  it("says a synthetic key measures application, not whether the positions are right", () => {
    expect(renderReport(report)).toContain("not whether CD's positions are right");
  });

  it("prints both sides of every pairing under --audit", () => {
    const text = renderReport(report, { audit: true });
    expect(text).toContain("AUDIT");
    expect(text).toContain("k-attrition");
    expect(text).toContain("The threshold is ninety percent (90%).");
    expect(text).toContain("not present here at all");
  });

  it("points at the audit trail when it was not printed", () => {
    expect(renderReport(report)).toContain("--audit");
  });
});
