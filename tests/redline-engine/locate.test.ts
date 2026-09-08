import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { NumberingResolver, loadDocx, walkPart, type WalkResult } from "@/lib/docx";
import { locateQuote } from "@/lib/redline-engine/locate";
import { isLocated } from "@/lib/redline-engine/types";
import { buildDocx, documentXml, headerXml, para, run, table } from "../helpers/docx-package";

/**
 * Finding the wording a model quoted (MASTER_PLAN.md §1.5.1).
 *
 * The tests that matter here are the ones where it must NOT answer. The engine
 * this replaces took the first match of a repeated phrase, which silently
 * redlines the wrong clause — a file that goes to a hotel with a change nobody
 * asked for. Refusing is recoverable; being confidently wrong is not.
 */

async function walk(bytes: Uint8Array | Buffer): Promise<WalkResult[]> {
  const pkg = await loadDocx(bytes);
  const numbering = new NumberingResolver(pkg.numbering);
  return pkg.textParts.map((p) => walkPart(p, numbering));
}

const fixture = (file: string) => readFile(path.join("tests", "fixtures", file));

const CLAUSE = "Group shall be liable for eighty percent (80%) of the group rate.";

describe("finding a quote", () => {
  it("finds wording quoted exactly", async () => {
    const parts = await walk(await buildDocx(para(run(CLAUSE))));
    const found = locateQuote(parts, "eighty percent (80%)", null);

    expect(found.resolution).toBe("exact");
    if (!isLocated(found)) throw new Error("expected a hit");
    expect(parts[0].text.slice(found.start, found.end)).toBe("eighty percent (80%)");
  });

  it("finds wording the model rewrapped and recapitalised", async () => {
    const parts = await walk(await buildDocx(para(run(CLAUSE))));
    const found = locateQuote(parts, "Eighty   Percent\n(80%)", null);

    expect(found.resolution).toBe("normalized");
    if (!isLocated(found)) throw new Error("expected a hit");
    expect(parts[0].text.slice(found.start, found.end)).toBe("eighty percent (80%)");
  });

  it("finds wording quoted with straight quotes when the contract has curly ones", async () => {
    const parts = await walk(await buildDocx(para(run("The “cutoff date” is thirty (30) days prior to arrival."))));
    const found = locateQuote(parts, '"cutoff date" is thirty (30) days', null);

    expect(isLocated(found)).toBe(true);
  });

  it("finds wording the model reworded slightly", async () => {
    const parts = await walk(await buildDocx(para(run(CLAUSE))));
    // One character off — a transcription slip, not a different clause.
    const found = locateQuote(parts, "Group shall be liable for eighty percent (80%) of the group rat.", null);

    expect(found.resolution).toBe("fuzzy");
    if (!isLocated(found)) throw new Error("expected a hit");
    expect(found.similarity).toBeGreaterThanOrEqual(0.95);
    expect(parts[0].text.slice(found.start, found.end)).toContain("eighty percent (80%)");
  });

  it("refuses wording that reads nothing like the contract", async () => {
    const parts = await walk(await buildDocx(para(run(CLAUSE))));
    const found = locateQuote(parts, "Hotel shall provide complimentary airport transfers for all attendees", null);

    expect(found.resolution).toBe("unresolved");
  });

  it("refuses a finding that quotes nothing", async () => {
    const parts = await walk(await buildDocx(para(run(CLAUSE))));
    expect(locateQuote(parts, null, null).resolution).toBe("unresolved");
    expect(locateQuote(parts, "   ", null).resolution).toBe("unresolved");
  });

  it("finds wording that lives in a header", async () => {
    const bytes = await buildDocx(para(run("The parties agree as follows.")), {
      "word/header1.xml": headerXml(para(run("Cutoff: thirty (30) days prior to arrival"))),
      "word/_rels/document.xml.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId9" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/></Relationships>`,
    });
    const parts = await walk(bytes);
    const found = locateQuote(parts, "thirty (30) days", null);

    expect(isLocated(found)).toBe(true);
    if (!isLocated(found)) return;
    expect(found.part).toBe("header1");
  });
});

describe("a phrase that appears more than once", () => {
  it("refuses rather than taking the first, when nothing says which is meant", async () => {
    // Fixture 11: "eighty percent (80%)" in four different clauses. The engine
    // this replaces edited whichever came first.
    const parts = await walk(await fixture("11-repeated-phrases.docx"));
    const found = locateQuote(parts, "eighty percent (80%)", null);

    expect(found.resolution).toBe("unresolved");
    if (isLocated(found)) return;
    expect(found.reason).toMatch(/appears 4 times/);
  });

  it("picks the right one when the finding names its section", async () => {
    const parts = await walk(await fixture("11-repeated-phrases.docx"));
    const found = locateQuote(parts, "eighty percent (80%)", "2. Cancellation");

    expect(isLocated(found)).toBe(true);
    if (!isLocated(found)) return;
    // The Cancellation clause, not Attrition, F&B or No-Show.
    const around = parts[0].text.slice(Math.max(0, found.start - 60), found.start);
    expect(around).toContain("Cancellation damages");
  });

  it("picks the right one from the section name alone", async () => {
    const parts = await walk(await fixture("11-repeated-phrases.docx"));
    const found = locateQuote(parts, "eighty percent (80%)", "Food and Beverage");

    expect(isLocated(found)).toBe(true);
    if (!isLocated(found)) return;
    const around = parts[0].text.slice(Math.max(0, found.start - 60), found.start);
    expect(around).toContain("F&B shortfall");
  });

  it("still refuses when the named section is not in the contract", async () => {
    const parts = await walk(await fixture("11-repeated-phrases.docx"));
    expect(locateQuote(parts, "eighty percent (80%)", "9. Indemnification").resolution).toBe("unresolved");
  });

  it("does not treat a stray number as a section heading", async () => {
    // "2" appears in a room count and a dollar figure. Matching the section
    // reference against raw text rather than headings would anchor on one of
    // those and answer confidently with the wrong clause.
    const body =
      "<w:p><w:pPr><w:pStyle w:val=\"Heading1\"/></w:pPr>" + run("1. Attrition") + "</w:p>" +
      para(run("A block of 275 rooms at $289.00 per night is held at eighty percent (80%).")) +
      "<w:p><w:pPr><w:pStyle w:val=\"Heading1\"/></w:pPr>" + run("2. Cancellation") + "</w:p>" +
      para(run("Cancellation damages are eighty percent (80%) of room revenue."));
    const parts = await walk(await buildDocx(body));
    const found = locateQuote(parts, "eighty percent (80%)", "2. Cancellation");

    expect(isLocated(found)).toBe(true);
    if (!isLocated(found)) return;
    expect(parts[0].text.slice(Math.max(0, found.start - 40), found.start)).toContain("Cancellation damages");
  });
});

describe("quotes that span a table", () => {
  it("finds a quote the model flattened across cells", async () => {
    // §1.4 verification showed the model quotes a schedule row by row, cells
    // joined with pipes. That has to be findable — whether it can be edited is
    // the applicability gate's problem, not this one's.
    const parts = await walk(
      await buildDocx(
        table([
          ["Days Prior to Arrival", "Damages"],
          ["365 or more", "25%"],
          ["180 to 91", "50%"],
        ])
      )
    );
    const found = locateQuote(parts, "180 to 91 | 50%", null);
    expect(isLocated(found)).toBe(true);
  });
});
