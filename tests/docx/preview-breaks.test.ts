import { describe, expect, it } from "vitest";
import { extractDocx } from "@/lib/docx";
import { buildPartPreview } from "@/lib/docx-preview";
import { buildDocx, para, run, table } from "../helpers/docx-package";

/**
 * A break and a table both begin with a newline in the reader's text. The
 * preview takes a table to start only where a row follows.
 */

const PAGE_BREAK = `<w:r><w:br w:type="page"/></w:r>`;
const kinds = async (body: string) => {
  const { document } = await extractDocx(await buildDocx(body));
  const blocks = buildPartPreview(document);
  return { blocks, kinds: blocks.map((b) => b.kind) };
};
const wording = (block: { kind: string; runs?: { text: string; kind: string }[] }) =>
  (block.runs ?? []).filter((r) => r.kind === "text").map((r) => r.text).join("");

describe("a paragraph that opens with a break", () => {
  it("reads as one paragraph, with no empty table before it", async () => {
    const { blocks, kinds: found } = await kinds(para(run("Signature page follows.")) + para(PAGE_BREAK + run("ACCEPTED AND AGREED")));
    expect(found).toEqual(["paragraph", "paragraph"]);
    expect(wording(blocks[1])).toBe("ACCEPTED AND AGREED");
  });

  it("reads as an empty paragraph when the break is all it holds", async () => {
    const { kinds: found } = await kinds(para(PAGE_BREAK) + para(run("Exhibit A")));
    expect(found).toEqual(["paragraph", "paragraph"]);
  });

  it("still reads a table that follows it", async () => {
    const { blocks, kinds: found } = await kinds(para(PAGE_BREAK + run("Rates")) + table([["Night", "Rate"], ["Monday", "$189"]]) + para(run("Deposits are due at signing.")));
    expect(found).toEqual(["paragraph", "table", "paragraph"]);
    expect(blocks[1].kind === "table" && blocks[1].rows.length).toBe(2);
  });

  it("keeps a break in the middle of a paragraph", async () => {
    const { blocks } = await kinds(para(run("Line one") + `<w:r><w:br/></w:r>` + run("Line two")));
    expect(blocks[0].kind === "paragraph" && blocks[0].runs.map((r) => r.kind)).toEqual(["text", "break", "text"]);
  });
});
