import { describe, expect, it } from "vitest";
import { extractDocx, isSynthetic, type ExtractedPart, type SourceRef } from "@/lib/docx";
import { buildPartPreview, type PreviewBlock } from "@/lib/docx-preview";
import { unreadNotes } from "@/lib/document-checks";
import { dryRunRedline } from "@/lib/exports/dry-run";
import { generateRedline, type RevisionFinding } from "@/lib/redline-engine";
import { placementMessage } from "@/lib/placement-message";
import { W_NS, buildDocx, del, para, run } from "../helpers/docx-package";

/**
 * Wording the reader used to pass over: text boxes, simple fields, plain
 * wrappers and wrapped table rows. Each is read now, and locked against the
 * redline. What is still unread is counted.
 */

const NS =
  `${W_NS} xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" ` +
  `xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape" ` +
  `xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" ` +
  `xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:v="urn:schemas-microsoft-com:vml"`;

const documentWith = (body: string) =>
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${NS}><w:body>${body}<w:sectPr/></w:body></w:document>`;

const modern = (inner: string) =>
  `<w:drawing><wp:anchor><a:graphic><a:graphicData><wps:wsp><wps:txbx><w:txbxContent>${inner}</w:txbxContent></wps:txbx></wps:wsp></a:graphicData></a:graphic></wp:anchor></w:drawing>`;
const older = (inner: string) => `<w:pict><v:rect><v:textbox><w:txbxContent>${inner}</w:txbxContent></v:textbox></v:rect></w:pict>`;

/** A run anchoring a box the way Word stores one: a modern copy and a copy for older programs. */
const boxTwice = (inner: string) =>
  `<w:r><mc:AlternateContent><mc:Choice Requires="wps">${modern(inner)}</mc:Choice><mc:Fallback>${older(inner)}</mc:Fallback></mc:AlternateContent></w:r>`;
const boxOlderOnly = (inner: string) => `<w:r>${older(inner)}</w:r>`;

const BILLING = para(run("Check all that may apply:")) + para(run("Room and tax to Master"));
const FILLER = Array.from({ length: 4 }, (_, i) => para(run(`Clause ${i + 1}. The Hotel will hold the rooms listed in this agreement until the cutoff date.`))).join("");

async function read(body: string, extra: Record<string, string> = {}) {
  const bytes = await buildDocx("", { "word/document.xml": documentWith(body), ...extra });
  return { bytes, extracted: await extractDocx(bytes) };
}
const paragraphs = (text: string) => text.split("\n\n").map((p) => p.trim()).filter(Boolean);

/** The map entry behind the first character of some wording. */
function refAt(part: ExtractedPart, wording: string): SourceRef {
  const entry = part.map[part.text.indexOf(wording)];
  if (!entry || isSynthetic(entry)) throw new Error(`"${wording}" is not wording from the file`);
  return entry;
}

const finding = (over: Partial<RevisionFinding>): RevisionFinding => ({
  id: "f1",
  location_section: null,
  clause_type: "billing",
  severity: "medium",
  is_missing_clause: false,
  quoted_text: "",
  quote_context: null,
  language: "",
  ...over,
});

describe("text boxes", () => {
  it("reads a box stored twice once, after the paragraph it hangs from", async () => {
    const { extracted } = await read(para(run("BILLING") + boxTwice(BILLING)) + para(run("Deposits are due at signing.")));
    expect(paragraphs(extracted.document.text)).toEqual(["BILLING", "Check all that may apply:", "Room and tax to Master", "Deposits are due at signing."]);
    expect(extracted.document.text.length).toBe(extracted.document.map.length);
    expect(extracted.health.unread).toBeUndefined();
  });

  it("reads a box stored only in the older form", async () => {
    const { extracted } = await read(para(run("BILLING") + boxOlderOnly(BILLING)));
    expect(paragraphs(extracted.document.text)).toEqual(["BILLING", "Check all that may apply:", "Room and tax to Master"]);
  });

  it("keeps a box in the table cell that anchors it, and reads a table inside a box as a table", async () => {
    const inCell = `<w:tbl><w:tr><w:tc>${para(run("Billing") + boxTwice(para(run("Direct bill"))))}</w:tc><w:tc>${para(run("Notes"))}</w:tc></w:tr></w:tbl>`;
    const tableInBox = para(run("RATES") + boxTwice(`<w:tbl><w:tr><w:tc>${para(run("Monday"))}</w:tc><w:tc>${para(run("$189"))}</w:tc></w:tr></w:tbl>`));
    const { extracted } = await read(inCell + tableInBox + FILLER);

    expect(extracted.document.text).toContain("| Billing Direct bill  | Notes  |");
    expect(extracted.document.text).toContain("| Monday  | $189  |");
    expect(extracted.health.checks.find((c) => c.name === "table_integrity")).toMatchObject({ passed: true });
    expect(extracted.health.route).toBe("docx_native");
  });

  it("leaves a box in a struck run out of the contract as it now reads", async () => {
    const { extracted } = await read(para(run("BILLING") + del(1, "Hotel", boxTwice(para(run("Old billing terms"))))));
    expect(extracted.document.text).not.toContain("Old billing terms");
    expect(extracted.document.originalText).toContain("Old billing terms");
  });

  it("marks no heading from a paragraph that only anchors a box, or inside one", async () => {
    const heading = `<w:pPr><w:pStyle w:val="Heading2"/></w:pPr>`;
    const { extracted } = await read(para(boxTwice(para(run("Inside the box"), heading)), heading) + para(run("PAYMENT"), heading));
    expect(paragraphs(extracted.document.text)).toEqual(["Inside the box", "## PAYMENT"]);
  });

  it("shows every character in the preview, with the box after its anchor", async () => {
    const { extracted } = await read(para(run("BILLING") + boxTwice(BILLING)) + para(run("Deposits are due at signing.")));
    const shown: string[] = [];
    const visit = (blocks: PreviewBlock[]) => {
      for (const b of blocks) {
        if (b.kind === "table") for (const row of b.rows) for (const cell of row.cells) visit(cell.blocks);
        else shown.push(b.runs.filter((r) => r.range).map((r) => r.text).join(""));
      }
    };
    visit(buildPartPreview(extracted.document));
    expect(shown).toEqual(["BILLING", "Check all that may apply:", "Room and tax to Master", "Deposits are due at signing."]);
  });
});

describe("wording inside other wrappers", () => {
  it("reads a simple field as a field result", async () => {
    const { extracted } = await read(para(run("Client: ") + `<w:fldSimple w:instr=" DOCPROPERTY Client ">${run("Acme Events")}</w:fldSimple>`));
    expect(extracted.document.text).toContain("Client: Acme Events");
    expect(refAt(extracted.document, "Acme Events").insideField).toBe(true);
  });

  it("reads through a smart tag and locks what it holds", async () => {
    const { extracted } = await read(para(run("The meeting is in ") + `<w:smartTag w:uri="urn:x" w:element="City">${run("Rome")}</w:smartTag>` + run(".")));
    expect(extracted.document.text).toContain("The meeting is in Rome.");
    expect(refAt(extracted.document, "Rome").insideUneditedMarkup).toBe(true);
    expect(refAt(extracted.document, "The meeting").insideUneditedMarkup).toBe(false);
  });

  it("reads a table row wrapped in a content control", async () => {
    const row = (a: string, b: string) => `<w:tr><w:tc>${para(run(a))}</w:tc><w:tc>${para(run(b))}</w:tc></w:tr>`;
    const { extracted } = await read(`<w:tbl>${row("Night", "Rate")}<w:sdt><w:sdtContent>${row("Monday", "$189")}</w:sdtContent></w:sdt></w:tbl>`);
    expect(extracted.document.text).toContain("| Monday  | $189  |");
    expect(refAt(extracted.document, "Monday").insideContentControl).toBe(true);
    expect(refAt(extracted.document, "Night").insideContentControl).toBe(false);
  });
});

describe("the redline and a text box", () => {
  const body = para(run("Master account billing is set out below.") + boxTwice(BILLING)) + FILLER;

  it("marks box wording as locked", async () => {
    const { extracted } = await read(body);
    expect(refAt(extracted.document, "Room and tax").insideTextBox).toBe(true);
    expect(refAt(extracted.document, "Master account").insideTextBox).toBe(false);
  });

  it("refuses a change quoted from a box, and says why", async () => {
    const { bytes } = await read(body);
    const check = await dryRunRedline(bytes, [finding({ quoted_text: "Room and tax to Master", language: "Room, tax and incidentals to Master" })]);
    const verdict = check.verdicts.get("f1");

    expect(verdict).toMatchObject({ placed: false, reason: "in_unedited_part" });
    expect(check.fallbackReason).toBeNull();
    expect(placementMessage({ reason: "in_unedited_part", detail: verdict!.detail, places: null }, null)).toBe(
      "The wording sits in a text box, which the redline doesn't change."
    );
  });

  it("still changes the paragraph the box hangs from, and keeps the box", async () => {
    const { bytes } = await read(body);
    const change = finding({ quoted_text: "Master account billing is set out below.", language: "Master account billing follows the choices below." });
    const check = await dryRunRedline(bytes, [change]);
    expect(check.verdicts.get("f1")).toMatchObject({ placed: true });
    expect(check.fallbackReason).toBeNull();

    const redline = await generateRedline({ originalDocxBytes: bytes, findings: [change], author: "Test" });
    const after = (await extractDocx(redline.docxBytes)).document.text;
    expect(after).toContain("Master account billing follows the choices below.");
    expect(after).toContain("Room and tax to Master");
  });
});

describe("wording the review did not read", () => {
  const footnotes = (inner: string) =>
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:footnotes ${W_NS}>` +
    `<w:footnote w:type="separator" w:id="-1">${para(run("rule"))}</w:footnote>${inner}</w:footnotes>`;

  it("counts a footnote, and leaves the route alone", async () => {
    const { extracted } = await read(FILLER, {
      "word/footnotes.xml": footnotes(`<w:footnote w:id="1">${para(run("Rates exclude the resort fee of $35 per night."))}</w:footnote>`),
    });
    expect(extracted.health.unread).toEqual([{ where: "footnotes", words: 9, sample: "Rates exclude the resort fee of $35 per night." }]);
    expect(extracted.health.route).toBe("docx_native");
  });

  it("counts nothing for the footnote rule Word adds itself", async () => {
    const { extracted } = await read(FILLER, { "word/footnotes.xml": footnotes("") });
    expect(extracted.health.unread).toBeUndefined();
  });

  it("counts wording in a structure the reader passes over", async () => {
    const { extracted } = await read(FILLER + para(`<w:unknownWrapper>${run("Hidden surcharge of 4%")}</w:unknownWrapper>`));
    expect(extracted.document.text).not.toContain("Hidden surcharge");
    expect(extracted.health.unread).toEqual([{ where: "a part of the file the review can't read", words: 4, sample: "Hidden surcharge of 4%" }]);
  });

  it("writes one note per place", () => {
    expect(unreadNotes([{ where: "footnotes", words: 9, sample: "Rates exclude the resort fee" }])).toEqual([
      {
        source: "check",
        headline: "The review didn't read 9 words in footnotes.",
        detail: 'The wording starts "Rates exclude the resort fee". Read that part of the contract by hand. Findings here don\'t use it.',
      },
    ]);
    expect(unreadNotes(undefined)).toEqual([]);
  });
});
