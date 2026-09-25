import { describe, expect, it } from "vitest";
import type { AnalysisResult, Finding } from "@/lib/anthropic";
import { redlineRun } from "@/lib/eval/redline";
import { renderReport } from "@/lib/eval/report";
import { scoreRun } from "@/lib/eval/score";
import type { AnswerKey, RunRecord } from "@/lib/eval/types";
import { buildDocx, para, run } from "../helpers/docx-package";

/**
 * Marking up a run's findings for the eval report.
 *
 * One small contract carries one of each result the report counts: a change
 * that applies, one that covers the whole sentence, one left out for a blank,
 * and one held back because it proposes no change.
 */

const CONTRACT = "c1.docx";

const PARAGRAPHS = [
  "Attrition is measured night-by-night. The threshold is ninety percent (90%).",
  "Commission of ten percent (10%) is payable on all rooms, whether such rooms are booked through the housing bureau or directly.",
  "Gratuity is twenty-two percent (22%).",
  "Reservations close forty-five (45) days prior to arrival.",
];

function finding(quoted_text: string, proposed_language: string, over: Partial<Finding> = {}): Finding {
  return {
    clause_type: "attrition",
    is_missing_clause: false,
    severity: "high",
    location_section: null,
    quoted_text,
    exposure_amount: null,
    exposure_basis: null,
    finding_text: "Unfavourable to the client.",
    cd_standard: "CD position.",
    proposed_language,
    model_confidence: "high",
    ...over,
  };
}

function analysis(findings: Finding[]): AnalysisResult {
  return {
    findings,
    clauses_checked: [],
    dropped_findings: [],
    document_notes: [],
    model_id: "claude-sonnet-5",
    standards_library_version: "v1",
    input_tokens: 0,
    output_tokens: 0,
    cache_read_input_tokens: 0,
    cache_creation_input_tokens: 0,
  };
}

const record = (documents: RunRecord["documents"]): RunRecord => ({
  run_id: "r1",
  created_at: "2026-09-23T00:00:00Z",
  model_id: "claude-sonnet-5",
  standards_version: "v1",
  standards_hash: "abc",
  documents,
});

const FINDINGS = [
  finding("The threshold is ninety percent (90%).", "The threshold is seventy percent (70%)."),
  finding(
    "Commission of ten percent (10%) is payable on all rooms",
    "Commission of ten percent (10%) is payable on all rooms booked by attendees.",
    { clause_type: "commission", severity: "medium" }
  ),
  finding("Gratuity is twenty-two percent (22%).", "Gratuity is [X] percent.", {
    clause_type: "gratuity_service_charge",
  }),
  finding("Reservations close forty-five (45) days prior to arrival.", "No change needed — retain as drafted.", {
    clause_type: "cutoff_date",
    severity: "note",
  }),
];

async function originals() {
  const bytes = await buildDocx(PARAGRAPHS.map((p) => para(run(p))).join(""));
  return new Map([[CONTRACT, bytes]]);
}

describe("redlineRun", () => {
  it("counts applied, whole-sentence, left-out and held-back findings", async () => {
    const summary = await redlineRun(
      record([{ contract: CONTRACT, analysis: analysis(FINDINGS), error: null, elapsed_ms: 0 }]),
      await originals()
    );

    expect(summary).toMatchObject({
      findings: 4,
      held_back: 1,
      applied: 2,
      widened: 1,
      unapplied: 1,
      by_reason: { unfilled_blank: 1 },
      failed_checks: 0,
      outcomes: { clean: 0, partial: 1, fallback: 0 },
    });

    const [contract] = summary.contracts;
    expect(contract.widened[0]).toMatchObject({ clause_type: "commission" });
    expect(contract.widened[0].struck).toContain("whether such rooms are booked through the housing bureau");
    expect(contract.unapplied[0]).toMatchObject({ clause_type: "gratuity_service_charge", reason: "unfilled_blank" });
  });

  it("gives the same result every time", async () => {
    const runRecord = record([{ contract: CONTRACT, analysis: analysis(FINDINGS), error: null, elapsed_ms: 0 }]);
    const first = await redlineRun(runRecord, await originals());
    const second = await redlineRun(runRecord, await originals());
    expect(second).toEqual(first);
  });

  it("records a failed analysis without marking anything up", async () => {
    const summary = await redlineRun(
      record([{ contract: CONTRACT, analysis: null, error: "timed out", elapsed_ms: 0 }]),
      await originals()
    );

    expect(summary.findings).toBe(0);
    expect(summary.contracts[0].outcome).toBeNull();
    expect(summary.outcomes).toEqual({ clean: 0, partial: 0, fallback: 0 });
  });

  it("renders the counts, and the audit lists what each contract left out or widened", async () => {
    const runRecord = record([{ contract: CONTRACT, analysis: analysis(FINDINGS), error: null, elapsed_ms: 0 }]);
    const key: AnswerKey = {
      version: "test-v1",
      source: "synthetic",
      standards_version: "v1",
      generated_at: "2026-09-23T00:00:00Z",
      contracts: [{ contract: CONTRACT, exhaustive: true, items: [] }],
    };
    const documents = new Map([[CONTRACT, [{ part: "document", text: PARAGRAPHS.join("\n") }]]]);
    const report = { ...scoreRun({ key, run: runRecord, documents }), redline: await redlineRun(runRecord, await originals()) };

    const text = renderReport(report);
    expect(text).toContain("REDLINE, EVERY FINDING ACCEPTED AS PROPOSED");
    expect(text).toMatch(/Applied +2 {3}1 of them also strike wording the finding didn't quote/);
    expect(text).toMatch(/unfilled_blank +1 {3}The proposed wording still has a blank to fill in\n/);

    const audit = renderReport(report, { audit: true });
    expect(audit).toContain("Redline: 2 applied, partial");
    expect(audit).toContain("[commission, medium]  also struck: , whether such rooms are booked");
    expect(audit).toContain("[gratuity_service_charge, high]  unfilled_blank");
  });
});
