import { describe, expect, it } from "vitest";
import { extractDocx } from "@/lib/docx";
import { buildDocx, del, para, run } from "../helpers/docx-package";

/**
 * The contract as it now reads. Whatever a tracked change struck is out of
 * the reading: wording, and also the tabs, breaks, table rows and paragraph
 * breaks that went with it.
 */

const read = async (body: string) => (await extractDocx(await buildDocx(body))).document;

describe("a tab or break inside struck wording", () => {
  const struckWithTab = del(1, "Hotel", `<w:r><w:tab/><w:delText xml:space="preserve">$5,000</w:delText></w:r>`);

  it("is left out of the reading, and kept in the contract as first written", async () => {
    const doc = await read(para(run("Deposit due at signing.") + struckWithTab));
    expect(doc.text).toBe("Deposit due at signing.\n\n");
    expect(doc.originalText).toBe("Deposit due at signing.\t$5,000\n\n");
    expect(doc.text.length).toBe(doc.map.length);
  });

  it("is still read where the wording stands", async () => {
    const doc = await read(para(run("Deposit") + `<w:r><w:tab/><w:t>$5,000</w:t></w:r>`));
    expect(doc.text).toBe("Deposit\t$5,000\n\n");
  });

  it("leaves a struck line break out too", async () => {
    const doc = await read(para(run("Line one") + del(1, "Hotel", `<w:r><w:br/><w:delText>Line two</w:delText></w:r>`)));
    expect(doc.text).toBe("Line one\n\n");
  });
});

const rowMark = (kind: "del" | "ins", id: number) => `<w:trPr><w:${kind} w:id="${id}" w:author="CD" w:date="2026-03-01T00:00:00Z"/></w:trPr>`;
const cell = (inner: string) => `<w:tc>${para(inner)}</w:tc>`;
const struckRow = (id: number, a: string, b: string) =>
  `<w:tr>${rowMark("del", id)}${cell(del(id + 100, "CD", `<w:r><w:delText>${a}</w:delText></w:r>`))}${cell(del(id + 200, "CD", `<w:r><w:delText>${b}</w:delText></w:r>`))}</w:tr>`;
const row = (a: string, b: string, mark = "") => `<w:tr>${mark}${cell(run(a))}${cell(run(b))}</w:tr>`;

describe("a struck table row", () => {
  it("is left out of the reading, and the rule sits under the first row that reads", async () => {
    const doc = await read(`<w:tbl>${struckRow(1, "Days Out", "Old Fee")}${row("Days Out", "Fee")}${row("90 to 31", "$35,000")}</w:tbl>`);
    expect(doc.text).toBe("\n| Days Out  | Fee  |\n| --- | --- |\n| 90 to 31  | $35,000  |\n\n");
    expect(doc.text.length).toBe(doc.map.length);
  });

  it("leaves no table behind when every row is struck", async () => {
    const doc = await read(para(run("Fees follow.")) + `<w:tbl>${struckRow(1, "Days Out", "Old Fee")}${struckRow(2, "90 to 31", "$80,000")}</w:tbl>` + para(run("Deposits are due at signing.")));
    expect(doc.text).toBe("Fees follow.\n\nDeposits are due at signing.\n\n");
    expect(doc.originalText).toContain("| Days Out  | Old Fee  |");
  });

  it("keeps a struck row in the preview, where it takes up no room in the text", async () => {
    const { buildPartPreview } = await import("@/lib/docx-preview");
    const doc = await read(`<w:tbl>${struckRow(1, "Days Out", "Old Fee")}${row("Days Out", "Fee")}</w:tbl>` + para(run("After the table.")));
    const [table, after] = buildPartPreview(doc);

    expect(table.kind === "table" && table.rows.length).toBe(2);
    const struck = table.kind === "table" ? table.rows[0].cells.flatMap((c) => c.blocks).flatMap((b) => (b.kind === "table" ? [] : b.runs)) : [];
    expect(struck.map((r) => r.text)).toEqual(["Days Out", "Old Fee"]);
    expect(struck.every((r) => r.range === null)).toBe(true);

    const wording = after.kind === "paragraph" ? after.runs[0] : null;
    expect(wording?.range && doc.text.slice(wording.range.start, wording.range.end)).toBe("After the table.");
  });

  it("reads an added row", async () => {
    const doc = await read(`<w:tbl>${row("Days Out", "Fee")}${row("30 to 0", "$50,000", rowMark("ins", 3))}</w:tbl>`);
    expect(doc.text).toContain("| 30 to 0  | $50,000  |");
    expect(doc.originalText).not.toContain("30 to 0");
  });
});

const breakDeleted = (id: number, more = "") =>
  `<w:pPr>${more}<w:rPr><w:del w:id="${id}" w:author="Hotel" w:date="2026-03-01T00:00:00Z"/></w:rPr></w:pPr>`;
const inList = (level = 0) => `<w:numPr><w:ilvl w:val="${level}"/><w:numId w:val="1"/></w:numPr>`;
const listItem = (text: string) => para(run(text), `<w:pPr>${inList()}</w:pPr>`);

describe("a deleted paragraph break", () => {
  it("joins the next paragraph into one sentence", async () => {
    const doc = await read(para(run("The Group shall pay "), breakDeleted(1)) + para(run("the balance at checkout.")) + para(run("Deposits are due at signing.")));
    expect(doc.text).toBe("The Group shall pay the balance at checkout.\n\nDeposits are due at signing.\n\n");
    expect(doc.originalText).toBe("The Group shall pay \n\nthe balance at checkout.\n\nDeposits are due at signing.\n\n");
    expect(doc.text.length).toBe(doc.map.length);
  });

  it("joins a chain under the first paragraph's number, and the next clause counts on from it", async () => {
    const { buildNumberedDocx } = await import("../helpers/docx-package");
    const body =
      listItem("Hotel will give notice of any renovation.") +
      para(run("Hotel will relocate the meeting"), breakDeleted(1, inList())) +
      para(del(2, "Hotel", `<w:r><w:delText>to another hotel, or</w:delText></w:r>`), breakDeleted(3, inList())) +
      para(run(" at its own cost."), `<w:pPr>${inList()}</w:pPr>`) +
      listItem("This clause is not changed.");
    const { document } = await extractDocx(await buildNumberedDocx(body));

    expect(document.text.split("\n\n").filter(Boolean)).toEqual([
      "1. Hotel will give notice of any renovation.",
      "2. Hotel will relocate the meeting at its own cost.",
      "3. This clause is not changed.",
    ]);
  });

  it("joins nothing before a table or at the end of a cell", async () => {
    const table = `<w:tbl><w:tr><w:tc>${para(run("Only cell"), breakDeleted(2))}</w:tc></w:tr></w:tbl>`;
    const doc = await read(para(run("Fees follow."), breakDeleted(1)) + table + para(run("After.")));
    expect(doc.text).toBe("Fees follow.\n\n\n| Only cell  |\n| --- |\n\nAfter.\n\n");
  });

  it("marks no heading where the paragraph's wording is all struck", async () => {
    const heading = `<w:pPr><w:pStyle w:val="Heading1"/></w:pPr>`;
    const doc = await read(para(del(1, "Hotel", `<w:r><w:delText>PARKING</w:delText></w:r>`), heading) + para(run("RATES"), heading));
    expect(doc.text).toBe("\n\n# RATES\n\n");
  });

  it("keeps the first paragraph's heading when its own wording is struck and the next is joined on", async () => {
    const heading = (id: number) => breakDeleted(id, `<w:pStyle w:val="Heading1"/>`);
    const doc = await read(para(del(1, "Hotel", `<w:r><w:delText>PARKING</w:delText></w:r>`), heading(2)) + para(run("RATES")));
    expect(doc.text).toBe("# RATES\n\n");
  });

  it("shows the paragraphs apart in the preview, and a highlight across the join lands on the right words", async () => {
    const { buildPartPreview, resolveHighlight } = await import("@/lib/docx-preview");
    const doc = await read(para(run("The Group shall pay "), breakDeleted(1)) + para(run("the balance at checkout.")));
    const blocks = buildPartPreview(doc);

    expect(blocks.map((b) => b.kind)).toEqual(["paragraph", "paragraph"]);
    const runs = blocks.flatMap((b) => (b.kind === "table" ? [] : b.runs));
    expect(runs.map((r) => r.range && doc.text.slice(r.range.start, r.range.end))).toEqual(["The Group shall pay ", "the balance at checkout."]);

    const hit = resolveHighlight([{ part: "document", text: doc.text, blocks }], "shall pay the balance");
    expect(hit && doc.text.slice(hit.start, hit.end)).toBe("shall pay the balance");
  });

  it("reads a text box anchored in a joined paragraph after the whole of it", async () => {
    const box = `<w:r><w:pict><v:rect xmlns:v="urn:schemas-microsoft-com:vml"><v:textbox><w:txbxContent>${para(run("In the box"))}</w:txbxContent></v:textbox></v:rect></w:pict></w:r>`;
    const doc = await read(para(run("First half, ") + box, breakDeleted(1)) + para(run("second half.")));
    expect(doc.text).toBe("First half, second half.\n\nIn the box\n\n");
  });
});
