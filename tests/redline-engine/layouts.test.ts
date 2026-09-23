import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { extractDocx } from "@/lib/docx";
import { generateRedline, type RedlineLayout, type RevisionFinding } from "@/lib/redline-engine";
import { validateRedline } from "@/lib/redline-validation";
import { buildDocx, ins, para, run } from "../helpers/docx-package";

/**
 * How a replacement is laid out as tracked changes.
 *
 * Every case goes through §1.6's oracle, which rejects our changes and checks
 * the original comes back. The oracle can't see the other direction, so each
 * case also reads the contract with every change accepted and checks the
 * proposal is there in place of the quote.
 */

const AUTHOR = "Jane Associate";

const finding = (quoted_text: string, language: string, id = "finding-1"): RevisionFinding => ({
  id,
  clause_type: "cancellation",
  severity: "high",
  is_missing_clause: false,
  quoted_text,
  language,
  finding_text: "Unfavourable to the client.",
  cd_standard: "CD position.",
  location_section: null,
});

async function redline(body: string, findings: RevisionFinding[], layout: RedlineLayout) {
  const originalBytes = await buildDocx(body);
  const result = await generateRedline({ originalDocxBytes: originalBytes, findings, author: AUTHOR, layout });
  const report = await validateRedline({ originalBytes, engineResult: result, author: AUTHOR });
  const xml = await (await JSZip.loadAsync(result.docxBytes)).file("word/document.xml")!.async("string");
  const accepted = (await extractDocx(result.docxBytes)).parts.find((p) => p.part === "document")!.text.trim();
  const count = (tag: string) => xml.match(new RegExp(`<${tag} [^>]*w:author="${AUTHOR}"`, "g"))?.length ?? 0;
  return { result, report, xml, accepted, deletions: count("w:del"), insertions: count("w:ins") };
}

const bold = (text: string) => `<w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">${text}</w:t></w:r>`;

const CLAUSE = "The Hotel may cancel on thirty (30) days notice to Group, without penalty of any kind.";
const CLOSE = finding(
  "The Hotel may cancel on thirty (30) days notice to Group, without penalty of any kind.",
  "The Hotel may cancel on ninety (90) days written notice to Group, subject to the cancellation schedule."
);

describe("whole layout", () => {
  it("strikes the whole passage and inserts the whole proposal after it", async () => {
    const { report, xml, accepted, deletions, insertions } = await redline(para(run(CLAUSE)), [CLOSE], "whole");
    expect(report.outcome).toBe("clean");
    expect([deletions, insertions]).toEqual([1, 1]);
    expect(xml.indexOf("<w:del ")).toBeLessThan(xml.indexOf("<w:ins "));
    expect(accepted).toBe(CLOSE.language);
  });
});

describe("insertion_first layout", () => {
  it("places the proposal before the struck passage", async () => {
    const { report, xml, accepted, deletions, insertions } = await redline(para(run(CLAUSE)), [CLOSE], "insertion_first");
    expect(report.outcome).toBe("clean");
    expect([deletions, insertions]).toEqual([1, 1]);
    expect(xml.indexOf("<w:ins ")).toBeLessThan(xml.indexOf("<w:del "));
    expect(accepted).toBe(CLOSE.language);
  });

  it("still nests inside wording the counterparty inserted", async () => {
    const body = para(run("Damages are ") + ins(500, "Dana Reyes", run("ninety percent (90%)")) + run(" of room revenue."));
    const { report, xml, accepted } = await redline(
      body,
      [finding("ninety percent (90%)", "fifty percent (50%)")],
      "insertion_first"
    );
    expect(report.outcome).toBe("clean");
    expect(xml).toMatch(/<w:ins[^>]*Dana Reyes[^>]*>\s*<w:ins[^>]*Jane Associate[^>]*>.*<\/w:ins>\s*<w:del[^>]*Jane Associate/);
    expect(accepted).toBe("Damages are fifty percent (50%) of room revenue.");
  });
});

describe("changed_words layout", () => {
  it("strikes only the changed words and leaves the shared ones as they were", async () => {
    const { report, xml, accepted, deletions, insertions } = await redline(para(run(CLAUSE)), [CLOSE], "changed_words");
    expect(report.outcome).toBe("clean");
    expect([deletions, insertions]).toEqual([2, 2]);
    expect(xml).toContain(">thirty (30) days</w:delText>");
    expect(xml).toContain(">ninety (90) days written</w:t>");
    expect(xml).toContain(">without penalty of any kind.</w:delText>");
    expect(xml).toContain(">subject to the cancellation schedule.</w:t>");
    expect(xml).toContain(">The Hotel may cancel on </w:t>");
    expect(accepted).toBe(CLOSE.language);
  });

  it("puts each insertion right after the words it replaces", async () => {
    const { xml } = await redline(para(run(CLAUSE)), [CLOSE], "changed_words");
    const order = [...xml.matchAll(/<w:(del|ins) /g)].map((m) => m[1]);
    expect(order).toEqual(["del", "ins", "del", "ins"]);
  });

  it("falls back to one whole change for a rewrite", async () => {
    const rewrite = finding(CLAUSE, "Either party may terminate this Agreement only as the cancellation schedule allows.");
    const { report, accepted, deletions, insertions } = await redline(para(run(CLAUSE)), [rewrite], "changed_words");
    expect(report.outcome).toBe("clean");
    expect([deletions, insertions]).toEqual([1, 1]);
    expect(accepted).toBe(rewrite.language);
  });

  it("changes words inside the quote only, leaving the rest of the paragraph alone", async () => {
    const body = para(run("Section 4. " + CLAUSE + " All notices must be in writing."));
    const { report, accepted } = await redline(body, [CLOSE], "changed_words");
    expect(report.outcome).toBe("clean");
    expect(accepted).toBe(`Section 4. ${CLOSE.language} All notices must be in writing.`);
  });

  it("keeps bold on a shared word, and formats inserted words like the ones they replace", async () => {
    const body = para(run("The Hotel may cancel on ") + bold("thirty (30) days") + run(" notice to Group, without penalty of any kind."));
    const { report, xml, accepted } = await redline(body, [CLOSE], "changed_words");
    expect(report.outcome).toBe("clean");
    expect(xml).toMatch(/<w:ins [^>]*><w:r><w:rPr><w:b\/><\/w:rPr><w:t xml:space="preserve">ninety \(90\) days written<\/w:t>/);
    expect(accepted).toBe(CLOSE.language);
  });

  it("keeps bold on a word that is shared", async () => {
    const body = para(run("The Hotel may cancel on thirty (30) days ") + bold("notice") + run(" to Group, without penalty of any kind."));
    const { report, xml, accepted } = await redline(body, [CLOSE], "changed_words");
    expect(report.outcome).toBe("clean");
    // "notice" is neither struck nor inserted, and still bold.
    expect(xml).toMatch(/<w:r><w:rPr><w:b\/><\/w:rPr><w:t xml:space="preserve">notice<\/w:t><\/w:r>/);
    expect(accepted).toBe(CLOSE.language);
  });

  it("works across a hyperlink", async () => {
    const body = para(
      run("The Hotel may cancel on thirty (30) days notice to ") +
        `<w:hyperlink w:anchor="parties">${run("Group")}</w:hyperlink>` +
        run(", without penalty of any kind.")
    );
    const { report, accepted } = await redline(body, [CLOSE], "changed_words");
    expect(report.outcome).toBe("clean");
    expect(accepted).toBe(CLOSE.language);
  });

  it("nests inside wording the counterparty inserted", async () => {
    const body = para(
      run("The Hotel may cancel on ") +
        ins(500, "Dana Reyes", run("thirty (30) days notice to Group,")) +
        run(" without penalty of any kind.")
    );
    const { report, xml, accepted } = await redline(body, [CLOSE], "changed_words");
    expect(report.outcome).toBe("clean");
    expect(xml).toMatch(/<w:ins[^>]*Dana Reyes[^>]*>.*<w:del[^>]*Jane Associate/);
    expect(accepted).toBe(CLOSE.language);
  });

  it("adds wording as a pure insertion", async () => {
    const quote = "Deposit is due on signing of this Agreement.";
    const addition = finding(quote, `${quote} No other deposit is required.`);
    const { report, accepted, deletions, insertions } = await redline(para(run(quote)), [addition], "changed_words");
    expect(report.outcome).toBe("clean");
    expect([deletions, insertions]).toEqual([0, 1]);
    expect(accepted).toBe(addition.language);
  });

  it("adds wording in front of the passage", async () => {
    const quote = "the rate is fixed for the term of this Agreement.";
    const addition = finding(quote, "Notwithstanding the foregoing, the rate is fixed for the term of this Agreement.");
    const { report, accepted, deletions, insertions } = await redline(para(run(quote)), [addition], "changed_words");
    expect(report.outcome).toBe("clean");
    expect([deletions, insertions]).toEqual([0, 1]);
    expect(accepted).toBe(addition.language);
  });

  it("removes wording as a pure deletion", async () => {
    const quote = "Group shall pay, without setoff or deduction, the full amount due on arrival.";
    const removal = finding(quote, "Group shall pay the full amount due on arrival.");
    const { report, accepted, deletions, insertions } = await redline(para(run(quote)), [removal], "changed_words");
    expect(report.outcome).toBe("clean");
    expect([deletions, insertions]).toEqual([1, 1]);
    expect(accepted).toBe(removal.language);
  });

  it("falls back to one whole change when the passage holds a tab", async () => {
    const body = para(run("Deposit schedule") + "<w:r><w:tab/></w:r>" + run("fifty percent (50%) on signing of this Agreement"));
    const { report, deletions, insertions } = await redline(
      body,
      [finding("schedule \t fifty percent (50%) on signing", "schedule: twenty-five percent (25%) on signing")],
      "changed_words"
    );
    expect(report.outcome).toBe("clean");
    expect([deletions, insertions]).toEqual([1, 1]);
  });

  it("applies two findings in one paragraph", async () => {
    const body = para(run("Group shall pay eighty percent of the block. Payment is due thirty (30) days before arrival."));
    const { result, report, accepted } = await redline(
      body,
      [
        finding("Group shall pay eighty percent of the block.", "Group shall pay seventy percent of the block.", "f1"),
        finding("Payment is due thirty (30) days before arrival.", "Payment is due ten (10) days before arrival.", "f2"),
      ],
      "changed_words"
    );
    expect(result.appliedCount).toBe(2);
    expect(report.outcome).toBe("clean");
    expect(accepted).toBe("Group shall pay seventy percent of the block. Payment is due ten (10) days before arrival.");
  });
});
