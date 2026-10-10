import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { extractDocx, loadDocx } from "@/lib/docx";
import { dryRunRedline } from "@/lib/exports/dry-run";
import { generateRedline, type RevisionFinding } from "@/lib/redline-engine";
import { acceptAll } from "../helpers/accept-all";
import { buildDocx, buildNumberedDocx, numbered, para, run, table } from "../helpers/docx-package";

/**
 * The rule the reader is held to: its reading of a contract as it now reads
 * equals a plain reading of the same file with every tracked change accepted.
 *
 * The clean Word copy accepts changes by its own code (lib/docx-accept.ts), so
 * the two are worked out separately and compared.
 */

const DIR = path.join("tests", "fixtures");

async function expectRuleHolds(bytes: Uint8Array) {
  const asRead = await extractDocx(bytes);
  const accepted = await extractDocx(await acceptAll(bytes));
  for (const part of asRead.parts) {
    expect(part.text, `part ${part.part}`).toBe(accepted.parts.find((p) => p.part === part.part)?.text);
  }
}

const finding = (over: Partial<RevisionFinding>): RevisionFinding => ({
  id: "f1",
  location_section: null,
  clause_type: "renovation",
  severity: "medium",
  is_missing_clause: false,
  quoted_text: "",
  quote_context: null,
  language: "",
  ...over,
});

describe("the reader agrees with the accepted file", () => {
  it("on every fixture that holds tracked changes", async () => {
    const fixtures = (await readdir(DIR)).filter((f) => f.endsWith(".docx")).sort();
    let tracked = 0;
    for (const name of fixtures) {
      const bytes = new Uint8Array(await readFile(path.join(DIR, name)));
      const pkg = await loadDocx(bytes);
      if (!pkg.textParts.some((p) => /<w:(ins|del|moveFrom|moveTo) /.test(p.xml))) continue;
      tracked++;
      await expectRuleHolds(bytes);
    }
    expect(tracked).toBeGreaterThan(3);
  });

  it("on a redline that replaces wording across paragraphs and changes a table", async () => {
    const body =
      numbered(run("Hotel will give notice of any renovation.")) +
      numbered(run("We may then elect, within fifteen days,")) +
      para(run("(A) to relocate your meeting, or")) +
      para(run("(B) to refund your deposit.")) +
      numbered(run("This clause is not changed.")) +
      table([["Days Prior to Arrival", "Catering Damages"], ["90 to 31", "$80,000 [80% of the minimum]"]]) +
      para(run("Deposits are due at signing."));
    const source = await buildNumberedDocx(body);
    const redline = await generateRedline({
      originalDocxBytes: source,
      author: "CD",
      findings: [
        finding({
          id: "across",
          quoted_text: "We may then elect, within fifteen days, (A) to relocate your meeting, or (B) to refund your deposit.",
          language: "Hotel will relocate the meeting at its own cost if a renovation disrupts it.",
        }),
        finding({ id: "cell", quoted_text: "$80,000 [80% of the minimum]", language: "$35,000 [35% of the minimum]" }),
      ],
    });
    expect(redline.unappliedIds).toEqual([]);

    await expectRuleHolds(redline.docxBytes);
    const { document } = await extractDocx(redline.docxBytes);
    expect(document.text).toContain("2. Hotel will relocate the meeting at its own cost if a renovation disrupts it.\n\n3. This clause is not changed.");
  });
});

describe("the redline on a file that comes back with a joined paragraph", () => {
  const breakDeleted = `<w:pPr><w:rPr><w:del w:id="900" w:author="Hotel" w:date="2026-03-01T00:00:00Z"/></w:rPr></w:pPr>`;
  const roundTwo = () =>
    buildDocx(
      para(run("The Group shall pay "), breakDeleted) +
        para(run("the balance at checkout.")) +
        para(run("The Hotel will hold the rooms listed in this agreement until the cutoff date.")) +
        para(run("Deposits are due at signing and are not refundable after the cutoff date."))
    );

  it("places a change inside the joined paragraph, and the file passes its check", async () => {
    const bytes = await roundTwo();
    const check = await dryRunRedline(bytes, [finding({ quoted_text: "the balance at checkout.", language: "the balance within 30 days of departure." })]);
    expect(check.verdicts.get("f1")).toMatchObject({ placed: true });
    expect(check.fallbackReason).toBeNull();
  });

  it("places a change quoted across the hotel's join where each paragraph can take its part", async () => {
    const bytes = await roundTwo();
    const change = finding({ quoted_text: "shall pay the balance", language: "will pay the balance" });
    const check = await dryRunRedline(bytes, [change]);
    expect(check.verdicts.get("f1")).toMatchObject({ placed: true });
    expect(check.fallbackReason).toBeNull();

    const redline = await generateRedline({ originalDocxBytes: bytes, author: "CD", findings: [change] });
    await expectRuleHolds(redline.docxBytes);
    expect((await extractDocx(redline.docxBytes)).document.text).toContain("The Group will pay the balance at checkout.\n\n");
  });

  it("refuses a whole rewrite across the hotel's join, since that break isn't ours to delete", async () => {
    const bytes = await roundTwo();
    const change = finding({ quoted_text: "The Group shall pay the balance at checkout.", language: "Payment is due thirty days after departure." });
    const check = await dryRunRedline(bytes, [change]);
    expect(check.verdicts.get("f1")).toMatchObject({ placed: false, reason: "crosses_boundary" });
    expect(check.fallbackReason).toBeNull();

    const redline = await generateRedline({ originalDocxBytes: bytes, author: "CD", findings: [change] });
    await expectRuleHolds(redline.docxBytes);
    expect((await extractDocx(redline.docxBytes)).document.text).toContain("The Group shall pay the balance at checkout.\n\n");
  });

  it("holds the rule after its own change is written", async () => {
    const bytes = await roundTwo();
    const redline = await generateRedline({
      originalDocxBytes: bytes,
      author: "CD",
      findings: [finding({ quoted_text: "the balance at checkout.", language: "the balance within 30 days of departure." })],
    });
    await expectRuleHolds(redline.docxBytes);
  });
});
