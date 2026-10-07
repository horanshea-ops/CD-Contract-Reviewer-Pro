import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { acceptOwnRevisions } from "@/lib/docx-accept";
import { generateRedline, type RevisionFinding } from "@/lib/redline-engine";
import { validateRedline } from "@/lib/redline-validation";
import { buildDocx, para, run, table } from "../helpers/docx-package";

/**
 * A change whose quote spans paragraphs.
 *
 * A real cancellation schedule holds each fee as two paragraphs in one cell:
 * the amount, then the formula behind it in brackets. The model quotes the
 * cell and proposes both lines changed. One tracked change can't cross a
 * paragraph break, so the engine makes one small change in each paragraph.
 *
 * The amounts and wording here are invented in the same shape.
 */

const AUTHOR = "Jane Associate";
const NOTE = "Keeps the group's costs in line with the rooms it uses.";

function finding(over: Partial<RevisionFinding> = {}): RevisionFinding {
  return {
    id: "finding-1",
    clause_type: "cancellation",
    severity: "high",
    is_missing_clause: false,
    quoted_text: null,
    language: "",
    finding_text: "Fee is on gross revenue.",
    cd_standard: "CD position.",
    location_section: null,
    ...over,
  };
}

async function redline(originalBytes: Uint8Array, findings: RevisionFinding[], comments = new Map<string, string>()) {
  const result = await generateRedline({ originalDocxBytes: originalBytes, findings, comments, author: AUTHOR });
  const report = await validateRedline({ originalBytes, engineResult: result, author: AUTHOR });
  const zip = await JSZip.loadAsync(result.docxBytes);
  const xml = await zip.file("word/document.xml")!.async("string");
  return { result, report, xml };
}

const failed = (report: { checks: { name: string; passed: boolean; detail: string }[] }) =>
  report.checks.filter((c) => !c.passed).map((c) => `${c.name}: ${c.detail}`);

/** The text inside every tracked change of one kind, in order. */
const marked = (xml: string, tag: "ins" | "del") =>
  [...xml.matchAll(new RegExp(`<w:${tag} [^>]*>([\\s\\S]*?)</w:${tag}>`, "g"))].map((m) =>
    [...m[1].matchAll(/<w:(?:t|delText)[^>]*>([^<]*)</g)].map((t) => t[1]).join("")
  );

const AMOUNT = "$50,000.00";
const FORMULA = "[determined by multiplying the Room Minimum, times the Group Rate, times 50%]";
const TWO_PARAGRAPH_CELL = para(run(AMOUNT)) + para(run(FORMULA));

/** A fee schedule whose second row holds its fee as two paragraphs in one cell. */
const schedule = () =>
  table([
    ["Days Before Arrival", "Room Cancellation Fee"],
    ["366 to 730", "CELL"],
    ["365 or fewer", "$90,000.00"],
  ]).replace(para(run("CELL")), TWO_PARAGRAPH_CELL);

describe("a change inside one table cell that holds two paragraphs", () => {
  const both = finding({
    quoted_text: `${AMOUNT} ${FORMULA}`,
    language: "$35,000.00 [determined by multiplying the Room Minimum, times the Group Rate, times 70%, times 50%]",
  });

  it("changes each paragraph where it stands, and leaves the table alone", async () => {
    const { result, report, xml } = await redline(await buildDocx(schedule()), [both]);

    expect(result.unapplied).toEqual([]);
    expect(result.appliedCount).toBe(1);
    expect(failed(report)).toEqual([]);
    expect(report.outcome).toBe("clean");
    // One table: nothing was struck and copied.
    expect((xml.match(/<w:tbl>/g) ?? []).length).toBe(1);
  });

  it("strikes the old amount and adds only the new words to the formula", async () => {
    const { xml } = await redline(await buildDocx(schedule()), [both]);

    expect(marked(xml, "del")).toEqual(["$50,000.00"]);
    expect(marked(xml, "ins").sort()).toEqual(["$35,000.00", "times 70%, "].sort());
  });

  it("changes one paragraph and leaves the other untouched", async () => {
    const { result, report, xml } = await redline(await buildDocx(schedule()), [
      finding({ quoted_text: `${AMOUNT} ${FORMULA}`, language: `$35,000.00 ${FORMULA}` }),
    ]);

    expect(result.appliedCount).toBe(1);
    expect(failed(report)).toEqual([]);
    expect(marked(xml, "del")).toEqual(["$50,000.00"]);
    expect(marked(xml, "ins")).toEqual(["$35,000.00"]);
  });

  it("gives back the original on Reject All, and the proposal once accepted", async () => {
    const originalBytes = await buildDocx(schedule());
    const { result, report } = await redline(originalBytes, [both]);
    expect(report.checks.find((c) => c.name === "reject_round_trip")?.passed).toBe(true);

    const clean = await acceptOwnRevisions(result.docxBytes, new Set(result.ownRevisionIds));
    const xml = await (await JSZip.loadAsync(clean)).file("word/document.xml")!.async("string");
    expect(xml).not.toMatch(/<w:(ins|del) /);

    // Read as text, since accepted wording sits in several runs.
    const paragraphs = [...xml.matchAll(/<w:p>([\s\S]*?)<\/w:p>/g)].map((p) => [...p[1].matchAll(/<w:t[^>]*>([^<]*)</g)].map((t) => t[1]).join(""));
    expect(paragraphs).toContain("$35,000.00");
    expect(paragraphs).toContain("[determined by multiplying the Room Minimum, times the Group Rate, times 70%, times 50%]");
    expect(paragraphs).not.toContain("$50,000.00");
    // Still two paragraphs in that cell, as the contract had.
    expect((xml.match(/<w:tc>/g) ?? []).length).toBe(6);
  });

  it("anchors the finding's comment on its changes", async () => {
    const { result, report } = await redline(await buildDocx(schedule()), [both], new Map([[both.id, NOTE]]));

    expect(failed(report)).toEqual([]);
    expect(result.ownCommentIds).toHaveLength(1);
  });

  it("takes several such changes in one schedule", async () => {
    const second = "$90,000.00";
    const body = table([
      ["Days Before Arrival", "Room Cancellation Fee"],
      ["366 to 730", "CELL"],
      ["365 or fewer", "CELL2"],
    ])
      .replace(para(run("CELL")), TWO_PARAGRAPH_CELL)
      .replace(para(run("CELL2")), para(run(second)) + para(run("[determined by multiplying the Room Minimum, times the Group Rate, times 90%]")));

    const { result, report, xml } = await redline(await buildDocx(body), [
      both,
      finding({
        id: "finding-2",
        quoted_text: `${second} [determined by multiplying the Room Minimum, times the Group Rate, times 90%]`,
        language: "$63,000.00 [determined by multiplying the Room Minimum, times the Group Rate, times 70%, times 90%]",
      }),
    ]);

    expect(result.unapplied).toEqual([]);
    expect(result.appliedCount).toBe(2);
    expect(failed(report)).toEqual([]);
    expect((xml.match(/<w:tbl>/g) ?? []).length).toBe(1);
  });
});

describe("a change spanning two body paragraphs", () => {
  const FIRST = "Attrition applies below eighty percent (80%) of the room block.";
  const SECOND = "Damages are charged at one hundred percent (100%) of the group rate.";
  const body = () => para(run(FIRST)) + para(run(SECOND)) + para(run("Deposits are due at signing."));

  it("changes a figure in each paragraph", async () => {
    const { result, report, xml } = await redline(await buildDocx(body()), [
      finding({
        clause_type: "attrition",
        quoted_text: `${FIRST}\n${SECOND}`,
        language:
          "Attrition applies below seventy percent (70%) of the room block.\nDamages are charged at seventy percent (70%) of the group rate.",
      }),
    ]);

    expect(result.unapplied).toEqual([]);
    expect(result.appliedCount).toBe(1);
    expect(failed(report)).toEqual([]);
    expect(report.outcome).toBe("clean");
    expect(marked(xml, "del").join(" | ")).toContain("eighty percent (80%)");
    expect(marked(xml, "del").join(" | ")).toContain("one hundred percent (100%)");
  });

  it("still refuses a proposal that moves wording across the paragraph break", async () => {
    // The second paragraph's opening is pulled up into the first, which no paragraph-by-paragraph change can show.
    const { result, report } = await redline(await buildDocx(body()), [
      finding({
        clause_type: "attrition",
        quoted_text: `${FIRST}\n${SECOND}`,
        language: "Attrition applies below seventy percent (70%) of the room block and damages follow the schedule attached as Exhibit B to this Agreement.",
      }),
    ]);

    expect(result.appliedCount).toBe(0);
    expect(result.unapplied.map((u) => u.reason)).toEqual(["crosses_boundary"]);
    expect(failed(report)).toEqual([]);
  });
});

describe("what stays refused", () => {
  it("is a quote that runs from a table into the text after it", async () => {
    const body = table([["Days", "Fee"], ["365 or fewer", "$90,000.00"]]) + para(run("Fees are due within thirty days."));
    const { result } = await redline(await buildDocx(body), [
      finding({ quoted_text: "$90,000.00\nFees are due within thirty days.", language: "$63,000.00\nFees are due within sixty days." }),
    ]);

    expect(result.appliedCount).toBe(0);
  });
});
