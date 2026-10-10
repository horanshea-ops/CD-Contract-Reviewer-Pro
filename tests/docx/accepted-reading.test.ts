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
