import { describe, expect, it } from "vitest";
import { extractDocx } from "@/lib/docx";
import { buildPartPreview } from "@/lib/docx-preview";
import { outlineOf, sectionTitle } from "@/lib/contract-outline";
import { W_NS, buildDocx, para, run, table } from "../helpers/docx-package";

/**
 * Clause numbers and headings, read the way Word reads them: from the
 * paragraph, then its style, with one count per list.
 */

const numberingXml = (inner: string) =>
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:numbering ${W_NS}>${inner}</w:numbering>`;
const stylesXml = (inner: string) =>
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles ${W_NS}>${inner}</w:styles>`;

const level = (ilvl: number, fmt: string, text: string, extra = "") =>
  `<w:lvl w:ilvl="${ilvl}"><w:start w:val="1"/><w:numFmt w:val="${fmt}"/>${extra}<w:lvlText w:val="${text}"/></w:lvl>`;
const DECIMAL = level(0, "decimal", "%1.") + level(1, "lowerLetter", "(%2)");
const num = (id: number, abstract: number, inner = "") => `<w:num w:numId="${id}"><w:abstractNumId w:val="${abstract}"/>${inner}</w:num>`;
const restartAt = (n: number) => `<w:lvlOverride w:ilvl="0"><w:startOverride w:val="${n}"/></w:lvlOverride>`;

const style = (id: string, pPr = "", basedOn = "") =>
  `<w:style w:type="paragraph" w:styleId="${id}"><w:name w:val="${id}"/>${basedOn && `<w:basedOn w:val="${basedOn}"/>`}<w:pPr>${pPr}</w:pPr></w:style>`;

const inList = (text: string, numId: number, ilvl = 0) =>
  para(run(text), `<w:pPr><w:numPr><w:ilvl w:val="${ilvl}"/><w:numId w:val="${numId}"/></w:numPr></w:pPr>`);
const styled = (text: string, styleId: string, more = "") => para(text ? run(text) : "", `<w:pPr><w:pStyle w:val="${styleId}"/>${more}</w:pPr>`);

async function read(body: string, parts: { numbering?: string; styles?: string }) {
  const extra: Record<string, string> = {};
  if (parts.numbering) extra["word/numbering.xml"] = numberingXml(parts.numbering);
  if (parts.styles) extra["word/styles.xml"] = stylesXml(parts.styles);
  return (await extractDocx(await buildDocx(body, extra))).document;
}
const paragraphs = (text: string) => text.split("\n\n").map((p) => p.trim()).filter(Boolean);

describe("list numbers", () => {
  it("follows a list that only points at a list style", async () => {
    const numbering =
      `<w:abstractNum w:abstractNumId="0"><w:numStyleLink w:val="Clauses"/></w:abstractNum>` +
      `<w:abstractNum w:abstractNumId="1"><w:styleLink w:val="Clauses"/>${DECIMAL}</w:abstractNum>` +
      num(1, 1) +
      num(2, 0);
    const doc = await read(inList("General", 2) + inList("Rooms", 2) + inList("Suites", 2, 1), { numbering });
    expect(paragraphs(doc.text)).toEqual(["1. General", "2. Rooms", "(a) Suites"]);
  });

  it("keeps one count across every instance of a list, and restarts where an instance says so", async () => {
    const numbering =
      `<w:abstractNum w:abstractNumId="0">${DECIMAL}</w:abstractNum>` +
      num(2, 0) +
      num(3, 0, restartAt(2)) +
      num(4, 0, restartAt(3)) +
      num(9, 0, restartAt(8));
    const body = [2, 3, 4, 2, 2, 9, 2].map((n, i) => inList(`Clause ${i}`, n)).join("");
    const doc = await read(body, { numbering });
    expect(paragraphs(doc.text).map((p) => p.split(" ")[0])).toEqual(["1.", "2.", "3.", "4.", "5.", "8.", "9."]);
  });

  it("counts on from a restart when the same instance is used again", async () => {
    const numbering = `<w:abstractNum w:abstractNumId="0">${DECIMAL}</w:abstractNum>` + num(1, 0) + num(2, 0, restartAt(1));
    const body = [1, 1, 2, 2].map((n, i) => inList(`Item ${i}`, n)).join("");
    const doc = await read(body, { numbering });
    expect(paragraphs(doc.text).map((p) => p.split(" ")[0])).toEqual(["1.", "2.", "1.", "2."]);
  });

  it("uses the level definition an instance replaces", async () => {
    const numbering =
      `<w:abstractNum w:abstractNumId="0">${DECIMAL}</w:abstractNum>` +
      num(1, 0, `<w:lvlOverride w:ilvl="0">${level(0, "upperRoman", "Article %1")}</w:lvlOverride>`);
    const doc = await read(inList("Rooms", 1) + inList("Rates", 1), { numbering });
    expect(paragraphs(doc.text)).toEqual(["Article I Rooms", "Article II Rates"]);
  });

  it("writes no marker where Word shows none", async () => {
    const numbering =
      `<w:abstractNum w:abstractNumId="0">${level(0, "decimal", "")}</w:abstractNum>` +
      `<w:abstractNum w:abstractNumId="1">${DECIMAL}</w:abstractNum>` +
      num(1, 0) +
      num(2, 1);
    const styles = style("Clause", `<w:numPr><w:numId w:val="2"/></w:numPr>`);
    const body =
      inList("An empty marker", 1) +
      styled("Numbered by its style", "Clause") +
      styled("Numbering switched off", "Clause", `<w:numPr><w:numId w:val="0"/></w:numPr>`);
    const doc = await read(body, { numbering, styles });
    expect(paragraphs(doc.text)).toEqual(["An empty marker", "1. Numbered by its style", "Numbering switched off"]);
  });

  it("keeps a dash for a list the file doesn't define", async () => {
    const doc = await read(inList("Loose item", 7), {});
    expect(paragraphs(doc.text)).toEqual(["- Loose item"]);
  });

  it("writes a plain bullet for one stored as a symbol-font glyph", async () => {
    const numbering = `<w:abstractNum w:abstractNumId="0">${level(0, "bullet", "")}</w:abstractNum>` + num(1, 0);
    const doc = await read(inList("Wi-Fi at no charge", 1), { numbering });
    expect(paragraphs(doc.text)).toEqual(["• Wi-Fi at no charge"]);
  });
});

describe("numbering and headings from the paragraph style", () => {
  const numbering =
    `<w:abstractNum w:abstractNumId="0">${level(0, "decimal", "%1.", `<w:pStyle w:val="Clause"/>`)}${level(1, "decimal", "%1.%2", `<w:pStyle w:val="SubClause"/>`)}</w:abstractNum>` +
    num(1, 0);
  const styles =
    style("Clause", `<w:numPr><w:numId w:val="1"/></w:numPr><w:outlineLvl w:val="0"/>`) +
    style("SubClause", `<w:numPr><w:numId w:val="1"/></w:numPr><w:outlineLvl w:val="1"/>`) +
    style("ClauseTight", "", "Clause") +
    style("Heading2AA", `<w:outlineLvl w:val="1"/>`) +
    style("Heading9A", `<w:outlineLvl w:val="8"/>`) +
    style("Body", `<w:outlineLvl w:val="9"/>`);

  it("numbers a heading through its style, at the level that names the style", async () => {
    const body = styled("GENERAL INFORMATION", "Clause") + styled("Dates", "SubClause") + styled("HOTEL ROOMS", "ClauseTight");
    const doc = await read(body, { numbering, styles });
    expect(paragraphs(doc.text)).toEqual(["# 1. GENERAL INFORMATION", "## 1.1 Dates", "# 2. HOTEL ROOMS"]);
  });

  it("reads a heading from the style's outline level, whatever the style is called", async () => {
    const body = styled("MEETING FACILITIES", "Heading2AA") + styled("Hotel Chain Name", "Heading9A") + styled("Plain wording", "Body");
    const doc = await read(body, { numbering, styles });
    expect(paragraphs(doc.text)).toEqual(["## MEETING FACILITIES", "###### Hotel Chain Name", "Plain wording"]);
  });

  it("still reads Heading1 by name in a file with no styles part", async () => {
    const doc = await read(styled("Room Block", "Heading1"), {});
    expect(paragraphs(doc.text)).toEqual(["# Room Block"]);
  });

  it("marks no heading on an empty paragraph or inside a table cell", async () => {
    const cell = `<w:tbl><w:tr><w:tc>${styled("Rooming List", "Heading2AA")}</w:tc></w:tr></w:tbl>`;
    const doc = await read(styled("", "Heading2AA") + cell + styled("HOTEL POLICIES", "Heading2AA"), { numbering, styles });
    expect(doc.text).not.toMatch(/#\s*\n/);
    expect(doc.text).toContain("| Rooming List  |");
    expect(doc.text).toContain("## HOTEL POLICIES");
  });

  it("still counts an empty numbered heading, as Word does", async () => {
    const body = styled("GENERAL INFORMATION", "Clause") + styled("", "Clause") + styled("HOTEL ROOMS", "Clause");
    const doc = await read(body, { numbering, styles });
    expect(paragraphs(doc.text)).toEqual(["# 1. GENERAL INFORMATION", "2.", "# 3. HOTEL ROOMS"]);
  });

  it("draws a numbered heading as a heading with its number, and outlines it as a numbered section", async () => {
    const doc = await read(styled("GENERAL INFORMATION", "Clause") + para(run("The dates are firm.")) + styled("HOTEL ROOMS", "Clause"), {
      numbering,
      styles,
    });

    const blocks = buildPartPreview(doc);
    expect(blocks[0]).toMatchObject({ kind: "heading", level: 1, marker: "1." });
    expect(blocks[0].kind === "heading" && blocks[0].runs.map((r) => r.text).join("")).toBe("GENERAL INFORMATION");
    expect(blocks[1]).toMatchObject({ kind: "paragraph" });
    expect(blocks[2]).toMatchObject({ kind: "heading", level: 1, marker: "2." });

    const sections = outlineOf(doc.text);
    expect(sections.map((s) => [s.number, sectionTitle(s)])).toEqual([
      ["1", "GENERAL INFORMATION"],
      ["2", "HOTEL ROOMS"],
    ]);
  });

  it("leaves a table after a numbered heading readable as a table", async () => {
    const doc = await read(styled("RATES", "Clause") + table([["Night", "Rate"], ["Monday", "$189"]]), { numbering, styles });
    const blocks = buildPartPreview(doc);
    expect(blocks.map((b) => b.kind)).toEqual(["heading", "table"]);
    expect(doc.text.length).toBe(doc.map.length);
  });
});
