import { readFile } from "node:fs/promises";
import path from "node:path";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { analyzeContract, buildPropertyEmailPayload, generateClientEmail, generatePropertyEmail } from "@/lib/anthropic";
import type { AnalysisResult } from "@/lib/anthropic";
import { extractDocx } from "@/lib/docx";
import { assembleEmailFindings } from "@/lib/email-drafting/input-assembly";
import { assemblePropertyEmailItems } from "@/lib/email-drafting/property-assembly";
import { generateRevisionsMemo } from "@/lib/export-memo";
import { generateRedline, type RevisionFinding } from "@/lib/redline-engine";
import { validateRedline } from "@/lib/redline-validation";
import { STANDARDS_LIBRARY } from "@/lib/standards/v1";
import { NORTHWIND_FINDINGS, NORTHWIND_ORG, NORTHWIND_STANDARDS, NORTHWIND_VERSION } from "./fixtures/portability/northwind";

/**
 * MASTER_PLAN §2.0.3's acceptance test. The pipeline runs end to end for an
 * invented client with its own standards library and still produces
 * structurally valid output. If it cannot, document mechanics and client
 * positions are entangled.
 *
 * The model is mocked with a canned response, so this covers everything the
 * code does around the model call. processAnalysis itself needs Supabase and
 * is not run. It passes clause_type through as a plain string to the same
 * stages this test calls.
 */

const { create } = vi.hoisted(() => ({ create: vi.fn() }));

vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = { create };
  },
}));

const toolResponse = (input: unknown) => ({
  content: [{ type: "tool_use", id: "toolu_portability", name: "tool", input }],
  stop_reason: "tool_use",
  usage: { input_tokens: 0, output_tokens: 0 },
});

const FIXTURE = path.join("tests", "fixtures", "01-clean-simple.docx");
const AUTHOR = "Jane Associate";
const HOTEL_CLAUSE_TYPES = new Set(STANDARDS_LIBRARY.map((e) => e.clause_type));

/** The firm's name in any form, as it would appear in text the model reads. */
const CD_NAME = /ConferenceDirect|\bCD\b/;

/** Every string in the request the model reads: prompts, descriptions, payload. */
const requestText = (request: unknown) => JSON.stringify(request);

let originalBytes: Uint8Array;
let analysis: AnalysisResult;
let analysisRequest: unknown;

beforeAll(async () => {
  vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
  originalBytes = new Uint8Array(await readFile(FIXTURE));
  const extracted = await extractDocx(originalBytes);

  create.mockResolvedValueOnce(
    toolResponse({ findings: NORTHWIND_FINDINGS, clauses_checked: NORTHWIND_STANDARDS.map((e) => e.clause_type), document_notes: "" })
  );
  analysis = await analyzeContract({
    document: { kind: "text", text: extracted.parts.map((p) => p.text).join("\n\n") },
    standards: NORTHWIND_STANDARDS,
    standardsVersion: NORTHWIND_VERSION,
    org: NORTHWIND_ORG,
  });
  analysisRequest = create.mock.calls[0][0];
});

beforeEach(() => {
  vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
});

describe("the dummy client is genuinely foreign", () => {
  it("shares no clause type with the hotel library", () => {
    for (const e of NORTHWIND_STANDARDS) expect(HOTEL_CLAUSE_TYPES.has(e.clause_type), e.clause_type).toBe(false);
  });
});

describe("analysis for another client", () => {
  it("sends that client's library and name, and nothing of CD's", () => {
    const text = requestText(analysisRequest);
    expect(text).toContain(NORTHWIND_VERSION);
    expect(text).toContain("Northwind Events (NWE), a corporate travel agency");
    for (const e of NORTHWIND_STANDARDS) expect(text).toContain(e.clause_type);
    expect(text).not.toMatch(CD_NAME);
  });

  it("returns well-formed findings under the new taxonomy", () => {
    expect(analysis.standards_library_version).toBe(NORTHWIND_VERSION);
    expect(analysis.findings.map((f) => f.clause_type)).toEqual(["performance_shortfall", "damages_formula", "dispute_forum"]);
    expect(analysis.clauses_checked).toEqual(NORTHWIND_STANDARDS.map((e) => e.clause_type));
  });
});

describe("document mechanics for another client", () => {
  const revisionFindings = (): RevisionFinding[] =>
    analysis.findings.map((f, i) => ({
      id: `northwind-${i}`,
      location_section: f.location_section,
      clause_type: f.clause_type,
      severity: f.severity,
      is_missing_clause: f.is_missing_clause,
      quoted_text: f.quoted_text,
      language: f.proposed_language,
      finding_text: f.finding_text,
      cd_standard: f.cd_standard,
    }));

  it("redlines every finding and passes the validation oracle", async () => {
    const result = await generateRedline({ originalDocxBytes: originalBytes, findings: revisionFindings(), author: AUTHOR });
    const report = await validateRedline({ originalBytes, engineResult: result, author: AUTHOR });

    expect(report.checks.filter((c) => !c.passed)).toEqual([]);
    expect(report.outcome).toBe("clean");
    expect(report.unapplied).toEqual([]);
    expect(report.appliedCount).toBe(3);
  });

  it("produces the revisions memo", async () => {
    const pdf = await generateRevisionsMemo({
      contractFilename: "01-clean-simple.docx",
      clientName: null,
      associateName: AUTHOR,
      findings: revisionFindings(),
    });
    expect(Buffer.from(pdf.subarray(0, 5)).toString()).toBe("%PDF-");
  });
});

describe("emails for another client", () => {
  const rows = () =>
    analysis.findings.map((f, i) => ({
      id: `northwind-${i}`,
      clause_type: f.clause_type,
      severity: f.severity,
      is_missing_clause: f.is_missing_clause,
      quoted_text: f.quoted_text,
      finding_text: f.finding_text,
      proposed_language: f.proposed_language,
      exposure_amount: f.exposure_amount,
      exposure_basis: f.exposure_basis,
    }));
  const accepted = () =>
    rows().map((r) => ({ finding_id: r.id, action: "accept", edited_language: null, created_at: "2026-09-11T00:00:00Z" }));

  it("drafts the client email under that client's name", async () => {
    const findings = assembleEmailFindings(rows(), accepted());
    expect(findings).toHaveLength(3);

    create.mockResolvedValueOnce(toolResponse({ subject: "s", body: "b" }));
    await generateClientEmail({ findings, associateName: AUTHOR, contractLabel: "Harborview Grand Hotel", org: NORTHWIND_ORG });

    const text = requestText(create.mock.lastCall![0]);
    expect(text).toContain("Northwind Events (NWE) associate");
    expect(text).toContain("performance shortfall");
    expect(text).not.toMatch(CD_NAME);
  });

  it("drafts the property email under that client's name", async () => {
    const items = assemblePropertyEmailItems(rows(), accepted());
    expect(buildPropertyEmailPayload(items, "Harborview Grand Hotel")).toContain("dispute forum (added");

    create.mockResolvedValueOnce(toolResponse({ subject: "s", body: "b" }));
    await generatePropertyEmail({ items, propertyLabel: "Harborview Grand Hotel", org: NORTHWIND_ORG });

    const text = requestText(create.mock.lastCall![0]);
    expect(text).toContain("Northwind Events (NWE) associate");
    expect(text).not.toMatch(CD_NAME);
  });
});
