import { readFile } from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { COMMENT_LIMIT, COMMENT_TEXT_LIMIT, extractDocx } from "@/lib/docx";
import { W_NS, buildDocx, del, delRun, docRelsXml, ins, para, run } from "../helpers/docx-package";

/**
 * Comments already in the file (lib/docx/comments.ts).
 *
 * They are read beside the contract text, never into it. The text and its map
 * are what every quote and every edit is placed against, so a comment must
 * leave both exactly as they were.
 */

const DIR = path.join("tests", "fixtures");
const load = async (f: string) => extractDocx(await readFile(path.join(DIR, f)));

const start = (id: number) => `<w:commentRangeStart w:id="${id}"/>`;
const end = (id: number) => `<w:commentRangeEnd w:id="${id}"/><w:r><w:commentReference w:id="${id}"/></w:r>`;

const W14 = 'xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml"';
const W15 = 'xmlns:w15="http://schemas.microsoft.com/office/word/2012/wordml"';

const comment = (id: number, text: string, paraId = "") =>
  `<w:comment w:id="${id}" w:author="Dana Reyes" w:date="2026-02-14T10:30:00Z"><w:p${paraId ? ` w14:paraId="${paraId}"` : ""}>${run(text)}</w:p></w:comment>`;

const commentsXml = (inner: string) =>
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:comments ${W_NS} ${W14}>${inner}</w:comments>`;

const withComments = (body: string, comments: string, extra: Record<string, string> = {}) =>
  buildDocx(body, {
    "word/comments.xml": commentsXml(comments),
    "word/_rels/document.xml.rels": docRelsXml([{ id: "rId9", type: "comments", target: "comments.xml" }]),
    ...extra,
  });

describe("comments already in the file", () => {
  it("reads each comment with its author, its text and the wording it sits on", async () => {
    const { comments } = await load("16-pages-export-comments.docx");

    expect(comments.map((c) => [c.id, c.author, c.text, c.quoted])).toEqual([
      ["21", "Dana Reyes", "Subject to negotiation.", "8"],
      [
        "24",
        "Dana Reyes",
        "Agreed.",
        "No mandatory resort fee applies to rooms in the block. Taxes are charged as required by law.",
      ],
      ["26", "Dana Reyes", "Can this be extended further?", "three days after the last night of the block"],
    ]);
  });

  it("gives the wording around a comment that sits on a single character", async () => {
    const { comments } = await load("16-pages-export-comments.docx");
    expect(comments[0].quoted).toBe("8");
    expect(comments[0].context).toBe("Hotel will pay a commission of 8% of the group room rate on all occupied rooms.");
  });

  it("marks context that stops short of the paragraph's ends", async () => {
    const long = "Every reservation in the block is held at the group rate until the cutoff date agreed between the parties, ";
    const body = para(run(long) + start(1) + run("fourteen days") + end(1) + run(` before arrival, and ${long}`));
    const { comments } = await extractDocx(await withComments(body, comment(1, "Earlier?")));

    expect(comments[0].context.startsWith("…")).toBe(true);
    expect(comments[0].context.endsWith("…")).toBe(true);
    expect(comments[0].context).toContain("parties, fourteen days before arrival");
  });

  it("anchors each comment on a range of the text the model reads", async () => {
    const { comments, document } = await load("16-pages-export-comments.docx");
    const last = comments[2];

    expect(last.part).toBe("document");
    expect(document.text.slice(last.start, last.end)).toBe("three days after the last night of the block");
  });

  it("leaves the text and its map exactly as they are without the comment ranges", async () => {
    const bytes = await readFile(path.join(DIR, "16-pages-export-comments.docx"));
    const zip = await JSZip.loadAsync(bytes);
    const xml = await zip.file("word/document.xml")!.async("string");
    zip.file("word/document.xml", xml.replace(/<w:commentRange(Start|End) w:id="\d+"\/>/g, ""));
    const stripped = await extractDocx(await zip.generateAsync({ type: "uint8array" }));
    const full = await extractDocx(bytes);

    expect(stripped.comments).toHaveLength(3);
    expect(full.document.text).toBe(stripped.document.text);
    expect(full.document.map).toEqual(stripped.document.map);
    expect(full.document.originalText).toBe(stripped.document.originalText);
  });

  it("reads none from a file that has none", async () => {
    const { comments, commentsTotal } = await load("01-clean-simple.docx");
    expect(comments).toEqual([]);
    expect(commentsTotal).toBe(0);
  });

  it("leaves a comment on struck wording with nothing quoted", async () => {
    const body = para(run("The cutoff is ") + start(1) + del(5, "Dana Reyes", delRun("thirty days")) + end(1) + run(" before arrival."));
    const { comments, document } = await extractDocx(await withComments(body, comment(1, "Removed.")));

    expect(comments[0].quoted).toBe("");
    expect(comments[0].start).toBe(comments[0].end);
    expect(document.text.slice(0, comments[0].start)).toContain("The cutoff is ");
  });

  it("quotes wording the property inserted, since the model reads it", async () => {
    const body = para(run("Attrition is ") + start(1) + ins(5, "Dana Reyes", run("eighty percent")) + end(1) + run("."));
    const { comments } = await extractDocx(await withComments(body, comment(1, "Raised.")));
    expect(comments[0].quoted).toBe("eighty percent");
  });

  it("anchors a comment that has only a reference at that point", async () => {
    const body = para(run("Deposit due at signing.") + `<w:r><w:commentReference w:id="1"/></w:r>` + run(" Balance due later."));
    const { comments, document } = await extractDocx(await withComments(body, comment(1, "When?")));

    expect(comments[0].quoted).toBe("");
    expect(document.text.slice(0, comments[0].start)).toContain("Deposit due at signing.");
    expect(document.text.slice(comments[0].start)).toContain("Balance due later.");
  });

  it("skips a comment nothing in the document points at", async () => {
    const body = para(start(1) + run("Deposit due at signing.") + end(1));
    const { comments } = await extractDocx(await withComments(body, comment(1, "Kept.") + comment(2, "Orphan.")));
    expect(comments.map((c) => c.id)).toEqual(["1"]);
  });

  it("reads which comment is a reply and which is resolved", async () => {
    const body = para(start(1) + start(2) + run("Deposit due at signing.") + end(1) + end(2));
    const extended =
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w15:commentsEx ${W15}>` +
      `<w15:commentEx w15:paraId="0000000A" w15:done="1"/>` +
      `<w15:commentEx w15:paraId="0000000B" w15:paraIdParent="0000000A" w15:done="0"/>` +
      `</w15:commentsEx>`;
    const { comments } = await extractDocx(
      await withComments(body, comment(1, "Why at signing?", "0000000A") + comment(2, "Hotel policy.", "0000000B"), {
        "word/commentsExtended.xml": extended,
      })
    );

    expect(comments.map((c) => [c.id, c.replyTo, c.resolved])).toEqual([
      ["1", null, true],
      ["2", "1", false],
    ]);
  });

  it("keeps the layout markers we add out of the quoted wording", async () => {
    const heading = para(start(1) + run("Deposit"), `<w:pPr><w:pStyle w:val="Heading1"/></w:pPr>`);
    const body = heading + para(run("Due at signing.") + end(1));
    const { comments } = await extractDocx(await withComments(body, comment(1, "Check.")));
    expect(comments[0].quoted).toBe("Deposit Due at signing.");
  });

  it("clips a long comment and a long quote", async () => {
    const long = "word ".repeat(400).trim();
    const body = para(start(1) + run(long) + end(1));
    const { comments } = await extractDocx(await withComments(body, comment(1, long)));

    expect(comments[0].text.length).toBeLessThanOrEqual(COMMENT_TEXT_LIMIT + 1);
    expect(comments[0].text.endsWith("…")).toBe(true);
    expect(comments[0].quoted.endsWith("…")).toBe(true);
    expect(comments[0].quoted.length).toBeLessThan(260);
  });

  it("keeps the first comments of a file with more than the limit, and reports the total", async () => {
    const count = COMMENT_LIMIT + 5;
    const ids = Array.from({ length: count }, (_, i) => i + 1);
    const body = ids.map((id) => para(start(id) + run(`Clause ${id}.`) + end(id))).join("");
    const { comments, commentsTotal } = await extractDocx(
      await withComments(body, ids.map((id) => comment(id, `Note ${id}`)).join(""))
    );

    expect(comments).toHaveLength(COMMENT_LIMIT);
    expect(commentsTotal).toBe(count);
    expect(comments[0].id).toBe("1");
  });
});
