import { describe, expect, it } from "vitest";
import type { createAdminClient } from "@/lib/supabase/admin";
import { generateRedline } from "@/lib/redline-engine";
import { diffRound } from "@/lib/round-diff/rounds";
import { buildDocx, para, run } from "../helpers/docx-package";

/**
 * Choosing what to compare a returned round against (MASTER_PLAN.md §2.1.1).
 *
 * The ladder is the point. Every rung answers a slightly different question,
 * and a diff that does not say which rung it stood on invites someone to read
 * a rebuilt document as the file the property actually received.
 */

const ASSOCIATE = "Jane Associate";
const TAIL = " of the shortfall measured against the contracted room block.";
const clause = (percent: string) => para(run(`Group shall pay ${percent}${TAIL}`));
const PREAMBLE = para(run("Group shall reserve a block of eighty (80) rooms for the nights of the Event."));

interface Db {
  analyses: Record<string, unknown>[];
  exports: Record<string, unknown>[];
  associates: Record<string, unknown>[];
  findings: Record<string, unknown>[];
  finding_actions: Record<string, unknown>[];
  storage: Record<string, Uint8Array>;
}

function fakeAdmin(db: Db) {
  const table = (name: keyof Db) => {
    let rows = [...((db[name] as Record<string, unknown>[]) ?? [])];
    const builder = {
      select: () => builder,
      eq: (col: string, value: unknown) => {
        rows = rows.filter((r) => r[col] === value);
        return builder;
      },
      in: (col: string, values: unknown[]) => {
        rows = rows.filter((r) => values.includes(r[col]));
        return builder;
      },
      order: (col: string, { ascending }: { ascending: boolean }) => {
        const dir = ascending ? 1 : -1;
        rows.sort((a, b) => (String(a[col]) < String(b[col]) ? -dir : String(a[col]) > String(b[col]) ? dir : 0));
        return builder;
      },
      maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
      then: (resolve: (r: { data: unknown[]; error: null }) => void) => resolve({ data: rows, error: null }),
    };
    return builder;
  };

  return {
    from: table,
    storage: {
      from: () => ({
        download: async (path: string) =>
          db.storage[path]
            ? { data: new Blob([db.storage[path] as Uint8Array<ArrayBuffer>]), error: null }
            : { data: null, error: { message: "not found" } },
      }),
    },
  } as unknown as ReturnType<typeof createAdminClient>;
}

const round = (over: Record<string, unknown>) => ({
  associate_id: "associate-1",
  thread_id: "thread-1",
  filename: "contract.docx",
  status: "complete",
  source_format: "docx",
  intake_route: "docx_native",
  storage_path: "converted.pdf",
  original_storage_path: null,
  accepted_view_text: null,
  parent_analysis_id: null,
  ...over,
});

/** Round 1 as the property drafted it, round 2 as they returned it. */
async function scenario(over: { exports?: Record<string, unknown>[]; db?: Partial<Db> } = {}) {
  const propertyDraft = await buildDocx(PREAMBLE + clause("eighty percent (80%)"));
  const returnedDraft = await buildDocx(PREAMBLE + clause("seventy-five percent (75%)"));
  const sentRedline = await generateRedline({
    originalDocxBytes: propertyDraft,
    findings: [
      {
        id: "finding-1",
        location_section: null,
        clause_type: "attrition",
        severity: "high",
        is_missing_clause: false,
        quoted_text: "eighty percent (80%)",
        language: "seventy percent (70%)",
        finding_text: "Above CD's position.",
        cd_standard: "70%.",
      },
    ],
    author: ASSOCIATE,
  });

  const db: Db = {
    analyses: [
      round({ id: "round-1", round_number: 1, original_storage_path: "orig-1.docx" }),
      round({ id: "round-2", round_number: 2, parent_analysis_id: "round-1", original_storage_path: "orig-2.docx" }),
    ],
    exports: over.exports ?? [],
    associates: [{ id: "associate-1", name: ASSOCIATE }],
    findings: [
      {
        id: "finding-1",
        analysis_id: "round-1",
        clause_type: "attrition",
        severity: "high",
        is_missing_clause: false,
        quoted_text: "eighty percent (80%)",
        location_section: null,
        finding_text: "Above CD's position.",
        cd_standard: "70%.",
        proposed_language: "seventy percent (70%)",
      },
    ],
    finding_actions: [
      { finding_id: "finding-1", action: "accept", edited_language: null, created_at: "2026-09-01T00:00:00Z" },
    ],
    storage: {
      "orig-1.docx": propertyDraft,
      "orig-2.docx": returnedDraft,
      "sent/redline.docx": sentRedline.docxBytes,
    },
    ...over.db,
  };

  return fakeAdmin(db);
}

describe("diffRound", () => {
  it("says plainly that a first round has nothing to compare against", async () => {
    const admin = await scenario();
    const result = await diffRound(admin, "round-1");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("first round");
  });

  it("refuses an analysis that does not exist", async () => {
    const admin = await scenario();
    const result = await diffRound(admin, "nonexistent");
    expect(result.ok).toBe(false);
  });

  it("compares against the file we actually sent, when it was kept", async () => {
    const admin = await scenario({
      exports: [
        {
          analysis_id: "round-1",
          associate_id: "associate-1",
          format: "docx",
          outcome: "clean",
          storage_path: "sent/redline.docx",
          created_at: "2026-09-02T00:00:00Z",
        },
      ],
    });

    const result = await diffRound(admin, "round-2");
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.diff.baselineSource).toBe("sent_export");
    expect(result.diff.confidence).toBe("high");
    expect(result.diff.regions).toHaveLength(1);
    expect(result.diff.regions[0].baselineText).toBe("seventy percent (70%)");
    expect(result.diff.regions[0].returnedText).toBe("seventy-five percent (75%)");
    expect(result.diff.ourChanges[0].retained).toBe(0);
  });

  it("rebuilds what we sent when the file was not kept, and says so", async () => {
    const admin = await scenario({
      exports: [
        {
          analysis_id: "round-1",
          associate_id: "associate-1",
          format: "docx",
          outcome: "clean",
          storage_path: null,
          created_at: "2026-09-02T00:00:00Z",
        },
      ],
    });

    const result = await diffRound(admin, "round-2");
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.diff.baselineSource).toBe("rebuilt_export");
    expect(result.diff.confidence).toBe("medium");
    expect(result.diff.baselineExplanation).toContain("rebuilt");
    expect(result.diff.regions[0].baselineText).toBe("seventy percent (70%)");
  });

  it("does not rebuild a redline for a round where the export was discarded", async () => {
    const admin = await scenario({
      exports: [
        {
          analysis_id: "round-1",
          associate_id: "associate-1",
          format: "docx",
          outcome: "fallback",
          storage_path: null,
          created_at: "2026-09-02T00:00:00Z",
        },
      ],
    });

    const result = await diffRound(admin, "round-2");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.diff.baselineSource).toBe("received_docx");
  });

  it("falls back to the property's own draft when nothing was ever exported", async () => {
    const admin = await scenario();
    const result = await diffRound(admin, "round-2");
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.diff.baselineSource).toBe("received_docx");
    expect(result.diff.baselineExplanation).toContain("changes they made");
    // Against their own draft, our requested change reads as their change.
    expect(result.diff.regions[0].baselineText).toBe("eighty percent (80%)");
  });

  it("falls back to the stored text when the Word file is gone", async () => {
    const admin = await scenario({
      db: {
        analyses: [
          round({
            id: "round-1",
            round_number: 1,
            original_storage_path: null,
            accepted_view_text: `Group shall reserve a block of eighty (80) rooms for the nights of the Event.\n\nGroup shall pay seventy percent (70%)${TAIL}`,
          }),
          round({ id: "round-2", round_number: 2, parent_analysis_id: "round-1", original_storage_path: "orig-2.docx" }),
        ],
      },
    });

    const result = await diffRound(admin, "round-2");
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.diff.baselineSource).toBe("stored_text");
    expect(result.diff.confidence).toBe("low");
    expect(result.diff.projector).toBe("plain");
    expect(result.diff.regions[0].returnedText).toBe("seventy-five percent (75%)");
  });

  it("refuses when the previous round has nothing on file at all", async () => {
    const admin = await scenario({
      db: {
        analyses: [
          round({ id: "round-1", round_number: 1, original_storage_path: null, storage_path: "missing.pdf" }),
          round({ id: "round-2", round_number: 2, parent_analysis_id: "round-1", original_storage_path: "orig-2.docx" }),
        ],
      },
    });

    const result = await diffRound(admin, "round-2");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("previous round");
  });

  it("carries the round numbers and the thread through", async () => {
    const admin = await scenario();
    const result = await diffRound(admin, "round-2");
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.diff.baselineRound).toBe(1);
    expect(result.diff.returnedRound).toBe(2);
    expect(result.diff.threadId).toBe("thread-1");
  });
});
