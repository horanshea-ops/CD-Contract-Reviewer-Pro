import { describe, expect, it, vi } from "vitest";
import { buildCleanDocx } from "@/lib/exports/clean-docx";
import type { ExportContext } from "@/lib/exports/context";
import { buildRedline, crashVerdict } from "@/lib/exports/redline";
import { respondWithExport } from "@/lib/exports/respond";
import { fakeDb, type Tables } from "./helpers/fake-db";
import { buildDocx, para, run } from "./helpers/docx-package";

vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(async () => {}) }));

/**
 * What the export dialog is told before a download.
 *
 * An engine crash once showed a bare error, offered no PDF and left no row in
 * the export record. A clean Word copy missing a change said nothing at all.
 */

const CLAUSE = "Group shall be liable for eighty percent (80%) of the group rate.";
const PATH = "originals/contract.docx";

let next = 0;

/** An export context over an in-memory database, with one accepted finding per quote. */
async function context(bytes: Uint8Array, changes: { quote: string; language: string }[]) {
  const analysisId = `analysis-${next++}`;
  const findings = changes.map((c, i) => ({
    id: `${analysisId}-f${i}`,
    analysis_id: analysisId,
    clause_type: "attrition",
    severity: "high",
    category: "business",
    is_missing_clause: false,
    quoted_text: c.quote,
    location_section: null,
    headline: null,
    finding_text: "Unfavourable to the client.",
    cd_standard: "CD position.",
    proposed_language: c.language,
  }));
  const tables: Tables = {
    findings,
    finding_actions: findings.map((f) => ({ finding_id: f.id, action: "accept", edited_language: null })),
    exports: [],
  };
  const ctx = {
    admin: fakeDb(tables, { [PATH]: bytes }),
    associate: { id: "associate-1", name: "Jane Associate" },
    analysis: {
      id: analysisId,
      associate_id: "associate-1",
      filename: "contract.docx",
      status: "complete",
      storage_path: "views/contract.pdf",
      original_storage_path: PATH,
      source_format: "docx",
      intake_route: "docx_native",
      thread_id: null,
      clients: null,
    },
    analysisId,
    includeComments: false,
  } as unknown as ExportContext;
  return { ctx, tables, analysisId };
}

const contract = () => buildDocx(para(run(CLAUSE)));
const SWAP = { quote: "eighty percent (80%)", language: "seventy percent (70%)" };
const NOT_THERE = { quote: "ninety percent (90%) of gross revenue", language: "fifty percent (50%) of room profit" };

describe("a redline the engine couldn't generate", () => {
  const NOT_A_WORD_FILE = new TextEncoder().encode("this is not a zip archive");

  it("reads as a fallback, with the marked-up PDF to turn to", () => {
    expect(crashVerdict("boom", "/api/analyses/a1/export-markup")).toEqual({
      outcome: "fallback",
      appliedCount: 0,
      unapplied: [],
      widened: [],
      fallbackReason: "The tracked changes could not be generated: boom",
      markupPdfUrl: "/api/analyses/a1/export-markup",
    });
  });

  it("gives the dialog the fallback verdict, where it gave a bare error", async () => {
    const { ctx, analysisId } = await context(NOT_A_WORD_FILE, [SWAP]);
    const result = await buildRedline(ctx);

    expect(result.kind).toBe("refusal");
    expect(result).toMatchObject({ status: 409, preflight: { outcome: "fallback", markupPdfUrl: `/api/analyses/${analysisId}/export-markup` } });
    expect((result.preflight as { fallbackReason: string }).fallbackReason).toMatch(/^The tracked changes could not be generated: /);
  });

  it("writes nothing on a preflight, and one fallback row on the real request", async () => {
    const { ctx, tables } = await context(NOT_A_WORD_FILE, [SWAP]);

    await respondWithExport(await buildRedline(ctx), { preflight: true });
    expect(tables.exports).toEqual([]);

    const response = await respondWithExport(await buildRedline(ctx), { preflight: false });
    expect(response.status).toBe(409);
    expect(tables.exports).toHaveLength(1);
    expect(tables.exports[0]).toMatchObject({ format: "docx", outcome: "fallback", findings_applied: 0 });
    expect(String(tables.exports[0].fallback_reason)).toMatch(/could not be generated/);
  });

  it("refuses the clean Word copy without recording the crash a second time", async () => {
    const { ctx, tables } = await context(NOT_A_WORD_FILE, [SWAP]);
    const result = await buildCleanDocx(ctx);

    expect(result.kind).toBe("refusal");
    expect(result.preflight).toBeNull();
    expect((result as { commit?: unknown }).commit).toBeUndefined();
    expect(String(result.kind === "refusal" && result.body.error)).toMatch(/PDF/);
    expect(tables.exports).toEqual([]);
  });
});

describe("the clean Word copy's check before download", () => {
  it("is clean when every accepted change went in", async () => {
    const { ctx } = await context(await contract(), [SWAP]);
    const result = await buildCleanDocx(ctx);

    expect(result.kind).toBe("file");
    expect(result.preflight).toMatchObject({ outcome: "clean", appliedCount: 1, unapplied: [] });
  });

  it("lists each change the copy lacks, with the reason in plain words", async () => {
    const { ctx } = await context(await contract(), [SWAP, NOT_THERE]);
    const result = await buildCleanDocx(ctx);

    expect(result.kind).toBe("file");
    expect(result.preflight).toMatchObject({ outcome: "partial", appliedCount: 1 });
    const { unapplied } = result.preflight as { unapplied: { quoted_text: string; reason: string; explanation: string }[] };
    expect(unapplied).toHaveLength(1);
    expect(unapplied[0]).toMatchObject({
      quoted_text: NOT_THERE.quote,
      reason: "not_located",
      explanation: "The quoted wording could not be found in the document.",
    });
  });

  it("answers a preflight with the verdict and writes nothing", async () => {
    const { ctx, tables } = await context(await contract(), [SWAP, NOT_THERE]);
    const response = await respondWithExport(await buildCleanDocx(ctx), { preflight: true });

    expect(await response.json()).toMatchObject({ outcome: "partial" });
    expect(tables.exports).toEqual([]);
  });
});
