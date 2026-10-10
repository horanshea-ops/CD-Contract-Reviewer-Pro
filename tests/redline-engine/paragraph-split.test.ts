import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { acceptOwnRevisions } from "@/lib/docx-accept";
import { generateRedline, type RevisionFinding } from "@/lib/redline-engine";
import { validateRedline } from "@/lib/redline-validation";
import { buildDocx, buildNumberedDocx, del, delRun, insertedPara, numbered, para, run, table } from "../helpers/docx-package";

/**
 * A change whose quote spans paragraphs.
 *
 * A real cancellation schedule holds each fee as two paragraphs in one cell:
 * the amount, then the formula behind it in brackets. The model quotes the
 * cell and proposes both lines changed. One tracked change can't cross a
 * paragraph break, so the engine makes one small change in each paragraph.
 *
 * A rewrite can't be split that way. The engine strikes the old wording in
 * every paragraph, puts the new wording in the first, and deletes the breaks
 * between so the emptied paragraphs close up into it. Word gives the joined
 * paragraph the first one's formatting (checked in Word for the web,
 * 2026-10-09).
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

/** The text inside every tracked change of one kind, in order. A mark on a paragraph break wraps nothing and is left out. */
const marked = (xml: string, tag: "ins" | "del") =>
  [...xml.matchAll(new RegExp(`<w:${tag} [^>]*[^/]>([\\s\\S]*?)</w:${tag}>`, "g"))].map((m) =>
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
});

describe("a rewrite that runs across paragraphs", () => {
  const FIRST = "Attrition applies below eighty percent (80%) of the room block.";
  const SECOND = "Damages are charged at one hundred percent (100%) of the group rate.";
  const LAST = "Deposits are due at signing.";
  const REWRITE = "Attrition and damages follow the schedule attached as Exhibit B to this Agreement.";
  const body = () => para(run(FIRST)) + para(run(SECOND)) + para(run(LAST));
  const rewrite = (over: Partial<RevisionFinding> = {}) =>
    finding({ clause_type: "attrition", quoted_text: `${FIRST}\n${SECOND}`, language: REWRITE, ...over });

  /** Paragraph breaks this export marks as deleted. */
  const deletedBreaks = (xml: string) => (xml.match(/<w:rPr><w:del [^>]*\/><\/w:rPr><\/w:pPr>/g) ?? []).length;
  const paragraphs = (xml: string) => xml.match(/<w:p>[\s\S]*?<\/w:p>|<w:p\/>/g) ?? [];
  const textOf = (xml: string) => [...xml.matchAll(/<w:t[^>]*>([^<]*)</g)].map((m) => m[1]).join("");

  async function accepted(originalBytes: Uint8Array, findings: RevisionFinding[]) {
    const out = await redline(originalBytes, findings);
    const clean = await acceptOwnRevisions(out.result.docxBytes, new Set(out.result.ownRevisionIds));
    const xml = await (await JSZip.loadAsync(clean)).file("word/document.xml")!.async("string");
    return { ...out, clean: xml };
  }

  it("strikes both paragraphs, inserts the new wording once, and deletes the break between", async () => {
    const { result, report, xml } = await redline(await buildDocx(body()), [rewrite()]);

    expect(result.unapplied).toEqual([]);
    expect(result.appliedCount).toBe(1);
    expect(failed(report)).toEqual([]);
    expect(report.outcome).toBe("clean");
    expect(marked(xml, "del")).toEqual([FIRST, SECOND]);
    expect(marked(xml, "ins")).toEqual([REWRITE]);
    expect(deletedBreaks(xml)).toBe(1);
    // The new wording sits in the first paragraph, ahead of the wording it replaces.
    expect(xml.indexOf(REWRITE)).toBeLessThan(xml.indexOf("eighty percent"));
  });

  it("leaves one paragraph once accepted", async () => {
    const { clean } = await accepted(await buildDocx(body()), [rewrite()]);

    expect(paragraphs(clean).map(textOf)).toEqual([REWRITE, LAST]);
  });

  it("joins three paragraphs, and the result keeps the first one's numbering", async () => {
    const SUB = `<w:pPr><w:ind w:left="1620" w:hanging="540"/></w:pPr>`;
    const clause =
      numbered(run("Hotel will give notice of any renovation.")) +
      numbered(run("We may then elect, within fifteen days,")) +
      para(run("(A) to relocate your meeting, or"), SUB) +
      para(run("(B) to refund your deposit."), SUB) +
      numbered(run("This paragraph stays."));
    const { result, report, xml, clean } = await accepted(await buildNumberedDocx(clause), [
      finding({
        quoted_text: "We may then elect, within fifteen days,\n(A) to relocate your meeting, or\n(B) to refund your deposit.",
        language: "Hotel will relocate the meeting at its own cost.",
      }),
    ]);

    expect(result.unapplied).toEqual([]);
    expect(failed(report)).toEqual([]);
    expect(deletedBreaks(xml)).toBe(2);

    const after = paragraphs(clean);
    expect(after.map(textOf)).toEqual([
      "Hotel will give notice of any renovation.",
      "Hotel will relocate the meeting at its own cost.",
      "This paragraph stays.",
    ]);
    expect(after[1]).toContain("<w:numPr>");
    expect(clean).not.toContain(`w:left="1620"`);
  });

  it("leaves the last paragraph in place when the quote stops partway through it", async () => {
    const LONG_SECOND = `${SECOND} Payment is due in thirty days.`;
    const original = para(run(FIRST)) + para(run(LONG_SECOND)) + para(run(LAST));
    const { result, report, xml, clean } = await accepted(await buildDocx(original), [rewrite()]);

    expect(result.unapplied).toEqual([]);
    expect(failed(report)).toEqual([]);
    expect(deletedBreaks(xml)).toBe(0);
    expect(paragraphs(clean).map(textOf)).toEqual([REWRITE, " Payment is due in thirty days.", LAST]);
  });

  it("closes up an empty paragraph between the two", async () => {
    const original = para(run(FIRST)) + para("") + para(run(SECOND)) + para(run(LAST));
    const { result, report, xml, clean } = await accepted(await buildDocx(original), [
      rewrite({ quoted_text: `${FIRST}\n\n${SECOND}` }),
    ]);

    expect(result.unapplied).toEqual([]);
    expect(failed(report)).toEqual([]);
    expect(deletedBreaks(xml)).toBe(2);
    expect(paragraphs(clean).map(textOf)).toEqual([REWRITE, LAST]);
  });

  it("anchors the finding's comment on the new wording", async () => {
    const f = rewrite();
    const { result, report } = await redline(await buildDocx(body()), [f], new Map([[f.id, NOTE]]));

    expect(failed(report)).toEqual([]);
    expect(result.ownCommentIds).toHaveLength(1);
  });

  describe("what it declines", () => {
    const DEPOSIT = finding({ id: "deposit", quoted_text: LAST, language: "Deposits are due thirty days after signing." });

    async function declined(original: string, findings: RevisionFinding[] = [rewrite(), DEPOSIT]) {
      const { result, report, xml } = await redline(await buildDocx(original), findings);
      expect(failed(report)).toEqual([]);
      expect(deletedBreaks(xml)).toBe(0);
      return result;
    }

    it("is a break that is also a section break", async () => {
      const section = `<w:pPr><w:sectPr><w:pgSz w:w="12240" w:h="15840"/></w:sectPr></w:pPr>`;
      const result = await declined(para(run(FIRST), section) + para(run(SECOND)) + para(run(LAST)));

      expect(result.appliedCount).toBe(1);
      expect(result.unapplied.map((u) => u.reason)).toEqual(["crosses_boundary"]);
    });

    it("is a break the property's own tracked change sits on", async () => {
      const result = await declined(insertedPara(5, "Dana Reyes", run(FIRST)) + para(run(SECOND)) + para(run(LAST)));

      expect(result.appliedCount).toBe(1);
      expect(result.unapplied.map((u) => u.reason)).toEqual(["crosses_boundary"]);
    });

    it("is a passage holding wording the property already struck", async () => {
      const struck = para(run("Attrition applies below ") + del(9, "Dana Reyes", delRun("ninety or ")) + run("eighty percent (80%) of the room block."));
      const result = await declined(struck + para(run(SECOND)) + para(run(LAST)));

      expect(result.appliedCount).toBe(1);
      expect(result.unapplied.map((u) => u.reason)).toEqual(["crosses_boundary"]);
    });

    it("is wording an earlier finding already changed", async () => {
      const earlier = finding({ id: "earlier", quoted_text: "one hundred percent (100%)", language: "seventy percent (70%)" });
      const later = rewrite({
        id: "later",
        quoted_text: `${FIRST}\nDamages are charged at seventy percent (70%) of the group rate.`,
      });
      const result = await declined(body(), [earlier, later]);

      expect(result.appliedCount).toBe(1);
      expect(result.unapplied.map((u) => u.reason)).toEqual(["overlaps_another_change"]);
    });
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
