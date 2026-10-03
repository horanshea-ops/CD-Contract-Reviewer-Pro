import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import {
  REDLINE_COMMENT_COLUMNS,
  assembleRedlineComments,
  type RedlineCommentRow,
} from "@/lib/redline-comments/assembly";
import { noteProblem, sanitizeNote } from "@/lib/redline-comments/note-guard";
import { generateRedline, type RevisionFinding } from "@/lib/redline-engine";
import { buildDocx, para, run } from "./helpers/docx-package";

/**
 * Redline comments reach the property (CLAUDE.md deviation 8). These tests
 * assert on what actually lands in the file, since a type alone proves nothing
 * about what a widened row would carry at runtime.
 */

const NOTE = "Keeps the group's costs in line with the rooms it uses.";
const SENTINELS = {
  finding_text: "SENTINEL-FINDING-TEXT the hotel is far above market",
  cd_standard: "SENTINEL-CD-STANDARD seventy percent and no higher",
  compromise_range: "SENTINEL-COMPROMISE settle up to seventy-five",
  severity: "SENTINEL-SEVERITY",
  exposure_basis: "SENTINEL-EXPOSURE",
  headline: "SENTINEL-HEADLINE",
};

/** Deliberately polluted, as a widened SELECT would make it. The cast is the point. */
function pollutedRow(over: Record<string, unknown> = {}): RedlineCommentRow {
  return {
    id: "f1",
    category: "business",
    redline_note: NOTE,
    edited_redline_note: null,
    ...SENTINELS,
    exposure_amount: 42000,
    ...over,
  } as unknown as RedlineCommentRow;
}

describe("assembling the comments", () => {
  it("carries the note and nothing else", () => {
    const comments = assembleRedlineComments([pollutedRow()]);
    expect([...comments]).toEqual([["f1", NOTE]]);
    expect(JSON.stringify([...comments])).not.toContain("SENTINEL");
  });

  it("prefers the associate's edit, and an empty edit means no comment", () => {
    expect(assembleRedlineComments([pollutedRow({ edited_redline_note: "Gives the group notice of works." })]).get("f1")).toBe(
      "Gives the group notice of works."
    );
    expect(assembleRedlineComments([pollutedRow({ edited_redline_note: "" })]).has("f1")).toBe(false);
  });

  it("drops legal findings", () => {
    expect(assembleRedlineComments([pollutedRow({ category: "legal" })]).size).toBe(0);
  });

  it("drops a stored note that fails the content check", () => {
    expect(assembleRedlineComments([pollutedRow({ redline_note: "Moves attrition to CD's standard." })]).size).toBe(0);
  });

  it("selects only the note columns", async () => {
    expect(REDLINE_COMMENT_COLUMNS.split(",").map((c) => c.trim())).toEqual([
      "id",
      "category",
      "redline_note",
      "edited_redline_note",
    ]);
    const source = await readFile("lib/redline-comments/assembly.ts", "utf8");
    expect(source.match(/\.select\(/g)).toHaveLength(1);
    expect(source).toContain(".select(REDLINE_COMMENT_COLUMNS)");
  });

  it("puts none of a finding's internal text into the redline file", async () => {
    const finding = {
      id: "f1",
      clause_type: "attrition",
      is_missing_clause: false,
      quoted_text: "eighty percent (80%)",
      language: "seventy percent (70%)",
      location_section: null,
      ...SENTINELS,
    } as unknown as RevisionFinding;
    const result = await generateRedline({
      originalDocxBytes: await buildDocx(para(run("Group shall be liable for eighty percent (80%) of the group rate."))),
      findings: [finding],
      comments: assembleRedlineComments([pollutedRow()]),
      author: "Jane Associate",
    });
    const zip = await JSZip.loadAsync(result.docxBytes);
    const comments = await zip.file("word/comments.xml")!.async("string");
    expect(comments).toContain("Keeps the group");
    for (const name of Object.keys(zip.files).filter((n) => !zip.files[n].dir)) {
      expect(await zip.file(name)!.async("string")).not.toContain("SENTINEL");
    }
  });
});

describe("the content check", () => {
  it.each([
    "Keeps the group's costs in line with the rooms it uses.",
    "Credits the group for rooms the hotel resells.",
    "Removes the fee on standard rooms.",
    "",
  ])("passes %j", (note) => {
    expect(noteProblem(note)).toBeNull();
  });

  it.each([
    ["Lowers damages to 70%.", "figures"],
    ["Caps the fee at $25.", "figures"],
    ["Lowers damages to seventy percent.", "percent"],
    ["Brings the clause in line with CD's standard.", "CD"],
    ["Matches ConferenceDirect guidance.", "ConferenceDirect"],
    ["Aligns with the industry norm.", "industry"],
    ["Our fallback if the hotel resists.", "fallback"],
    ["Leaves room to compromise later.", "compromise"],
    ["Reflects the group's position on attrition.", "position"],
    ["Gives the group leverage on the rate.", "leverage"],
    ["Starts the negotiation lower.", "negotiate"],
  ])("refuses %j", (note, why) => {
    expect(noteProblem(note)).toContain(why === "figures" ? "figures" : why);
  });

  it("refuses a filler word standing in for a note", () => {
    for (const filler of ["placeholder", "N/A", "none", "TBD", "No comment."]) {
      expect(noteProblem(filler), filler).toContain("full sentence");
      expect(sanitizeNote(filler)).toBe("");
    }
    expect(noteProblem("Keeps the rate available longer.")).toBeNull();
  });

  it("refuses a note over the length limit", () => {
    expect(noteProblem("word ".repeat(30))).toContain("at most");
  });

  it("refuses a note that repeats CD's own wording on the finding", () => {
    const problem = noteProblem("Keeps attrition damages tied to actual room pickup.", {
      cd_standard: "Attrition damages tied to actual room pickup, never the full block.",
    });
    expect(problem).toContain("internal notes");
  });

  it("allows common phrasing that only shares filler words", () => {
    expect(
      noteProblem("Gives the group notice of the change.", { finding_text: "The hotel gives the group no notice of the change." })
    ).toBeNull();
  });

  it("stores a failing note as blank", () => {
    expect(sanitizeNote("Lowers damages to 70%.")).toBe("");
    expect(sanitizeNote("  Credits the group   for resold rooms. ")).toBe("Credits the group for resold rooms.");
  });
});
