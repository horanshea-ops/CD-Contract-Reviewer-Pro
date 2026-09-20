import { describe, expect, it } from "vitest";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { extractDocx } from "@/lib/docx";
import { contractText } from "@/lib/docx/contract-text";
import { compareVersions, joinParts, type VersionInput } from "@/lib/round-diff/compare";
import {
  buildDocx,
  buildHeaderDocx,
  buildNumberedDocx,
  del,
  delRun,
  ins,
  numbered,
  para,
  run,
  table,
} from "../helpers/docx-package";

/**
 * A round of negotiation, compared end to end (MASTER_PLAN.md §2.1.1).
 *
 * Twelve pairs, in the manner of §1.11's fixture corpus: what we sent, and
 * what the property sent back. Each pair is one thing a property actually
 * does — accept, reject, counter, add, move, renumber, or return something
 * else entirely.
 */

const US = ["Jane Associate"];
const THEM = "Hotel Counsel";

async function version(bytes: Uint8Array): Promise<VersionInput> {
  const joined = joinParts((await extractDocx(bytes)).parts);
  return { text: joined.text, document: joined };
}

/** A round stored only as text, as a PDF-route round would be. */
const asText = (side: VersionInput): VersionInput => ({ text: side.text, document: null });

const ROOM_BLOCK = "Group shall reserve a block of eighty (80) rooms for the nights of the Event.";
const CUTOFF = "Unreserved rooms release to general inventory thirty (30) days before arrival.";
const FORCE_MAJEURE = "Obligations are suspended while a force majeure event continues in effect.";
const ATTRITION_TAIL = " of the shortfall measured against the contracted room block.";

/** The attrition clause as we sent it — our change to 70%, still marked. */
const OUR_REDLINE =
  run("Group shall pay ") +
  del(1, US[0], delRun("eighty percent (80%)")) +
  ins(2, US[0], run("seventy percent (70%)")) +
  run(ATTRITION_TAIL);

/** The same clause as plain text, at whatever percentage. */
const attrition = (percent: string) => run(`Group shall pay ${percent}${ATTRITION_TAIL}`);

const sentBody = [para(run(ROOM_BLOCK)), para(run(CUTOFF)), para(OUR_REDLINE)].join("");
const sent = () => buildDocx(sentBody);

const returnedBody = (attritionRun: string, extra: string[] = []) =>
  [para(run(ROOM_BLOCK)), para(run(CUTOFF)), para(attritionRun), ...extra].join("");

describe("joinParts", () => {
  it("produces exactly the text stored as the round's accepted view", async () => {
    const files = (await readdir(path.join("tests", "fixtures"))).filter((f) => f.endsWith(".docx"));
    for (const file of files.sort()) {
      const extracted = await extractDocx(await readFile(path.join("tests", "fixtures", file)));
      expect(joinParts(extracted.parts).text, file).toBe(contractText(extracted));
    }
  });

  it("keeps a map the same length as the text it joined", async () => {
    const extracted = await extractDocx(await readFile(path.join("tests", "fixtures", "06-header-footer-terms.docx")));
    const joined = joinParts(extracted.parts);
    expect(joined.map).toHaveLength(joined.text.length);
    expect(joined.parts.map((p) => p.part.part)).toContain("header1");
  });

  it("places each part where its text really starts", async () => {
    const extracted = await extractDocx(await readFile(path.join("tests", "fixtures", "06-header-footer-terms.docx")));
    const joined = joinParts(extracted.parts);
    for (const { part, offset } of joined.parts) {
      expect(joined.text.slice(offset, offset + part.text.trimEnd().length)).toBe(part.text.trimEnd());
    }
  });
});

describe("compareVersions", () => {
  it("1. reports nothing when the property accepted everything and sent it back clean", async () => {
    const result = compareVersions(
      await version(await sent()),
      await version(await buildDocx(returnedBody(attrition("seventy percent (70%)")))),
      { ours: US }
    );

    expect(result.regions).toEqual([]);
    expect(result.retained).toBe(1);
    expect(result.ourChanges.map((c) => c.retained)).toEqual([1]);
  });

  it("2. reports our change put back the way it was, and says none of it survived", async () => {
    const result = compareVersions(
      await version(await sent()),
      await version(await buildDocx(returnedBody(attrition("eighty percent (80%)")))),
      { ours: US }
    );

    expect(result.regions).toHaveLength(1);
    expect(result.regions[0].kind).toBe("replace");
    expect(result.regions[0].baselineText).toBe("seventy percent (70%)");
    expect(result.regions[0].returnedText).toBe("eighty percent (80%)");
    expect(result.ourChanges).toHaveLength(1);
    expect(result.ourChanges[0].retained).toBe(0);
  });

  it("3. reports a counter-offer between the two positions", async () => {
    const result = compareVersions(
      await version(await sent()),
      await version(await buildDocx(returnedBody(attrition("seventy-five percent (75%)")))),
      { ours: US }
    );

    expect(result.regions).toHaveLength(1);
    expect(result.regions[0].returnedText).toBe("seventy-five percent (75%)");
    expect(result.regions[0].part).toBe("document");
  });

  it("4. separates a change they made from a clause they added", async () => {
    const result = compareVersions(
      await version(await sent()),
      await version(
        await buildDocx(
          returnedBody(attrition("eighty percent (80%)"), [para(run(FORCE_MAJEURE))])
        )
      ),
      { ours: US }
    );

    expect(result.regions.map((r) => r.kind)).toEqual(["replace", "insert"]);
    expect(result.regions[1].returnedText).toBe(FORCE_MAJEURE);
    expect(result.regions[1].baselineText).toBe("");
  });

  it("5. names the counterparty when they left track changes on", async () => {
    const theirEdit =
      run("Group shall pay ") +
      del(9, THEM, delRun("seventy percent (70%)")) +
      ins(10, THEM, run("eighty percent (80%)")) +
      run(ATTRITION_TAIL);

    const result = compareVersions(
      await version(await sent()),
      await version(await buildDocx(returnedBody(theirEdit))),
      { ours: US }
    );

    expect(result.regions).toHaveLength(1);
    expect(result.regions[0].attribution).toBe("tracked");
    expect(result.regions[0].authors).toEqual([THEM]);
  });

  it("6. sees their edit made inside wording we inserted", async () => {
    // Our insertion still stands, with their deletion nested inside it.
    const nested =
      run("Group shall pay ") +
      ins(2, US[0], run("seventy ")) +
      ins(3, US[0], del(4, THEM, delRun("percent "))) +
      ins(5, US[0], run("(70%)")) +
      run(ATTRITION_TAIL);

    const result = compareVersions(
      await version(await sent()),
      await version(await buildDocx(returnedBody(nested))),
      { ours: US }
    );

    expect(result.regions).toHaveLength(1);
    expect(result.regions[0].authors).toEqual([THEM]);
    expect(result.ourChanges[0].retained).toBeLessThan(1);
  });

  it("7. reports one insertion when a new clause renumbered every clause below it", async () => {
    const before = await buildNumberedDocx(
      [numbered(run(ROOM_BLOCK)), numbered(run(CUTOFF)), numbered(attrition("seventy percent (70%)"))].join("")
    );
    const after = await buildNumberedDocx(
      [
        numbered(run(FORCE_MAJEURE)),
        numbered(run(ROOM_BLOCK)),
        numbered(run(CUTOFF)),
        numbered(attrition("seventy percent (70%)")),
      ].join("")
    );

    const result = compareVersions(await version(before), await version(after), { ours: US });
    expect(result.regions).toHaveLength(1);
    expect(result.regions[0].kind).toBe("insert");
    expect(result.regions[0].returnedText).toBe(FORCE_MAJEURE);
  });

  it("8. places a change made inside a cancellation table in its own cell", async () => {
    const grid = (fee: string) =>
      table([
        ["Days before arrival", "Cancellation fee"],
        ["90 or more", "25%"],
        ["Fewer than 30", fee],
      ]);

    const result = compareVersions(
      await version(await buildDocx(para(run(ROOM_BLOCK)) + grid("100%"))),
      await version(await buildDocx(para(run(ROOM_BLOCK)) + grid("80%"))),
      { ours: US }
    );

    expect(result.regions).toHaveLength(1);
    expect(result.regions[0].returnedText).toBe("80%");
    expect(result.regions[0].cell).not.toBeNull();
    expect(result.regions[0].cell!.tableIndex).toBe(0);
  });

  it("9. reads a clause the property moved as a move", async () => {
    const body = (order: string[]) => order.map((c) => para(run(c))).join("");
    const clauses = [
      ROOM_BLOCK,
      CUTOFF,
      "Payment falls due fourteen days following departure without further demand.",
      "Parking, wifi and fitness access are billed separately at published nightly rates.",
      FORCE_MAJEURE,
    ];

    const result = compareVersions(
      await version(await buildDocx(body(clauses))),
      await version(await buildDocx(body([...clauses.slice(1), clauses[0]]))),
      { ours: US }
    );

    const moves = result.regions.filter((r) => r.kind === "move");
    expect(moves).toHaveLength(2);
    expect(moves.map((m) => m.baselineText || m.returnedText).join(" ")).toContain("block of eighty");
  });

  it("10. refuses to pretend a different draft is a set of edits", async () => {
    const other = [
      para(run("This letter of intent records the parties' preliminary understanding only.")),
      para(run("Neither side is bound until a definitive agreement is signed by both.")),
      para(run("All disputes are referred to arbitration in the county of the hotel.")),
    ].join("");

    const result = compareVersions(
      await version(await sent()),
      await version(await buildDocx(other)),
      { ours: US }
    );

    expect(result.rebased).toBe(true);
    expect(result.retained).toBeLessThan(0.4);
  });

  it("11. still compares a round held only as text, and says which projector ran", async () => {
    const mapped = compareVersions(
      await version(await sent()),
      await version(await buildDocx(returnedBody(attrition("eighty percent (80%)")))),
      { ours: US }
    );
    const textOnly = compareVersions(
      asText(await version(await sent())),
      await version(await buildDocx(returnedBody(attrition("eighty percent (80%)")))),
      { ours: US }
    );

    expect(mapped.projector).toBe("mapped");
    expect(textOnly.projector).toBe("plain");
    expect(textOnly.regions.map((r) => r.returnedText)).toEqual(
      mapped.regions.map((r) => r.returnedText)
    );
    // The returned side still has its map, so the part is still known. What is
    // lost is the baseline's revision marks, and with them any account of what
    // became of the changes we made.
    expect(textOnly.regions[0].part).toBe("document");
    expect(textOnly.ourChanges).toEqual([]);
    expect(mapped.ourChanges).toHaveLength(1);
  });

  it("12. finds a change made to a term that lives in the header", async () => {
    const header = (days: string) => para(run(`Cancellation notice is due ${days} before arrival.`));

    const result = compareVersions(
      await version(await buildHeaderDocx(para(run(ROOM_BLOCK)), header("thirty (30) days"))),
      await version(await buildHeaderDocx(para(run(ROOM_BLOCK)), header("sixty (60) days"))),
      { ours: US }
    );

    expect(result.regions).toHaveLength(1);
    expect(result.regions[0].part).toBe("header1");
    // "days" is unchanged on both sides, so the region stops at the words that moved.
    expect(result.regions[0].returnedText).toBe("sixty (60)");
    expect(result.regions[0].baselineText).toBe("thirty (30)");
  });
});

describe("clause mapping", () => {
  it("names the clause a change falls in, under both numbering schemes", async () => {
    const heading = (text: string) => para(run(text), `<w:pPr><w:pStyle w:val="Heading1"/></w:pPr>`);
    const body = (percent: string) =>
      [
        heading("1. Room Block"),
        para(run(ROOM_BLOCK)),
        heading("2. Attrition"),
        para(attrition(percent)),
      ].join("");

    const result = compareVersions(
      await version(await buildDocx(body("seventy percent (70%)"))),
      await version(await buildDocx(body("eighty percent (80%)"))),
      { ours: US }
    );

    expect(result.regions).toHaveLength(1);
    expect(result.regions[0].section?.number).toBe("2");
    expect(result.regions[0].section?.label).toBe("2. Attrition");
  });

  it("reports the clause number each side used when a change shifted the numbering", async () => {
    const before = await buildNumberedDocx(
      [numbered(run(ROOM_BLOCK)), numbered(attrition("seventy percent (70%)"))].join("")
    );
    const after = await buildNumberedDocx(
      [numbered(run(FORCE_MAJEURE)), numbered(run(ROOM_BLOCK)), numbered(attrition("eighty percent (80%)"))].join("")
    );

    const result = compareVersions(await version(before), await version(after), { ours: US });
    const changed = result.regions.find((r) => r.kind === "replace")!;

    expect(changed.baselineSection?.number).toBe("2");
    expect(changed.section?.number).toBe("3");
  });
});
