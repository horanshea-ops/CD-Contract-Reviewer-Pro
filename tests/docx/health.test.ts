import { describe, expect, it } from "vitest";
import { extractDocx } from "@/lib/docx";
import { buildDocx, para, run } from "../helpers/docx-package";

/**
 * The text-volume check at upload. It measures the wording read against the
 * document's own XML, so a picture's size never counts against a contract.
 */

const clause = (i: number) => para(run(`Clause ${i}. The Hotel will hold the rooms listed in this agreement until the cutoff date.`));
const SHORT_CONTRACT = [1, 2, 3, 4].map(clause).join("");

const volume = async (bytes: Uint8Array) => {
  const { health } = await extractDocx(bytes);
  return { check: health.checks.find((c) => c.name === "text_volume")!, route: health.route, reason: health.reason };
};

describe("text volume", () => {
  it("passes a short contract however large its pictures make the file", async () => {
    // Random bytes don't compress, so the archive really is over 2 MB.
    const picture = new Uint8Array(2 * 1024 * 1024).map((_, i) => (i * 2654435761) >>> 24);
    const bytes = await buildDocx(SHORT_CONTRACT, { "word/media/image1.png": picture });
    expect(bytes.byteLength).toBeGreaterThan(1024 * 1024);

    const { check, route } = await volume(bytes);
    expect(check.passed).toBe(true);
    expect(route).toBe("docx_native");
  });

  it("fails a file with almost no wording, as a file of scanned pages has", async () => {
    const { check, route, reason } = await volume(await buildDocx(para(run("Page 1")) + para(run("Page 2")) + para(run("Page 3"))));
    expect(check.passed).toBe(false);
    expect(route).toBe("pdf");
    expect(reason).toContain("Very little readable text");
  });

  it("fails a file whose XML is large and nearly empty of wording", async () => {
    const padding = para("<w:r><w:rPr><w:b/><w:i/><w:color w:val=\"000000\"/></w:rPr></w:r>".repeat(400)).repeat(20);
    const { check } = await volume(await buildDocx(SHORT_CONTRACT + padding));
    expect(check.passed).toBe(false);
    expect(check.detail).toContain("of document XML");
  });
});
