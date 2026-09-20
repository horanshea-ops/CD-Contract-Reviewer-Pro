import { describe, expect, it } from "vitest";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { extractDocx, NumberingResolver, loadDocx, walkPart, type WalkResult } from "@/lib/docx";
import { projectMapped, projectPlain, toSourceRange } from "@/lib/round-diff/projection";
import { buildDocx, buildNumberedDocx, numbered, para, run, table } from "../helpers/docx-package";

/**
 * The projection a round diff compares (MASTER_PLAN.md §2.1.1).
 *
 * The test that matters most is the renumbering one. A property that inserts a
 * clause shifts every list number after it, and a diff that reads those numbers
 * buries the one real change under a hundred false ones.
 */

async function walk(bytes: Uint8Array): Promise<WalkResult> {
  const pkg = await loadDocx(bytes);
  const numbering = new NumberingResolver(pkg.numbering);
  return pkg.textParts.map((p) => walkPart(p, numbering)).find((p) => p.part === "document")!;
}

const projected = async (bytes: Uint8Array) => {
  const part = await walk(bytes);
  return projectMapped(part.text, part.map);
};

describe("projectMapped", () => {
  it("reads the same wording out of a document whose clauses were renumbered", async () => {
    const before = await buildNumberedDocx(
      [
        numbered(run("Group shall reserve eighty (80) rooms.")),
        numbered(run("Rooms release thirty (30) days before arrival.")),
        numbered(run("Group shall pay the shortfall.")),
      ].join("")
    );
    // The property inserts a clause at the top, so 1, 2, 3 become 2, 3, 4.
    const after = await buildNumberedDocx(
      [
        numbered(run("Hotel shall hold the rate through the cutoff.")),
        numbered(run("Group shall reserve eighty (80) rooms.")),
        numbered(run("Rooms release thirty (30) days before arrival.")),
        numbered(run("Group shall pay the shortfall.")),
      ].join("")
    );

    const beforeText = (await walk(before)).text;
    expect(beforeText).toContain("1. Group shall reserve");
    expect((await walk(after)).text).toContain("2. Group shall reserve");

    // Every clause that survived reads identically once the numbers are gone.
    const a = (await projected(before)).text;
    const b = (await projected(after)).text;
    expect(b).toContain(a);
    expect(b.replace("Hotel shall hold the rate through the cutoff. ", "")).toBe(a);
  });

  it("drops heading marks and table furniture", async () => {
    const bytes = await buildDocx(
      [
        para(run("Cancellation"), `<w:pPr><w:pStyle w:val="Heading1"/></w:pPr>`),
        table([
          ["Days before arrival", "Fee"],
          ["90", "50%"],
        ]),
      ].join("")
    );
    const { text } = await projected(bytes);
    expect(text).toBe("Cancellation Days before arrival Fee 90 50%");
  });

  it("keeps a no-break hyphen, which is wording, and drops a bullet, which is not", async () => {
    const bytes = await buildDocx(
      [
        para(`<w:r><w:t xml:space="preserve">night</w:t><w:noBreakHyphen/><w:t>by</w:t></w:r>`),
        para(run("Cumulative."), `<w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="9"/></w:numPr></w:pPr>`),
      ].join("")
    );
    const part = await walk(bytes);
    expect(part.text).toContain("- Cumulative.");

    const { text } = projectMapped(part.text, part.map);
    expect(text).toBe("night-by Cumulative.");
  });

  it("collapses every run of whitespace to one space", async () => {
    const bytes = await buildDocx(para(run("eighty   percent\t(80%)")));
    expect((await projected(bytes)).text).toBe("eighty percent (80%)");
  });

  it("keeps an origin for every character, pointing at real source text", async () => {
    const bytes = await buildDocx(
      [para(run("Group shall reserve rooms.")), table([["Fee"], ["50%"]])].join("")
    );
    const part = await walk(bytes);
    const projection = projectMapped(part.text, part.map);

    expect(projection.origin).toHaveLength(projection.text.length);
    for (let i = 0; i < projection.text.length; i++) {
      const source = part.text[projection.origin[i]];
      // A character maps to itself; an inserted separator points at the
      // character it precedes.
      expect(projection.text[i] === source || projection.text[i] === " ").toBe(true);
    }
  });

  it("refuses a map that is not the same length as its text", () => {
    expect(() => projectMapped("abc", [{ synthetic: true }])).toThrow(/2 characters|1 entries/);
  });
});

describe("projectPlain", () => {
  it("reads the same wording as the mapped projector, across the fixture corpus", async () => {
    const files = (await readdir(path.join("tests", "fixtures"))).filter((f) => f.endsWith(".docx"));
    expect(files.length).toBeGreaterThan(10);

    for (const file of files.sort()) {
      const extracted = await extractDocx(await readFile(path.join("tests", "fixtures", file)));
      for (const part of extracted.parts) {
        expect(projectPlain(part.text).text, `${file} / ${part.part}`).toBe(
          projectMapped(part.text, part.map).text
        );
      }
    }
  });

  it("strips a numbered clause label the same way the mapped projector does", () => {
    expect(projectPlain("2. Attrition\n\nGroup shall pay.").text).toBe("Attrition Group shall pay.");
    expect(projectPlain("  5.2. Cutoff\n").text).toBe("Cutoff");
  });

  it("drops a table's separator row and its pipes", () => {
    const rows = ["| Days | Fee |", "| --- | --- |", "| 90 | 50% |"].join("\n");
    expect(projectPlain(rows).text).toBe("Days Fee 90 50%");
  });

  it("keeps a pipe that is not part of a table row", () => {
    expect(projectPlain("Rate A | Rate B applies.").text).toBe("Rate A | Rate B applies.");
  });
});

describe("toSourceRange", () => {
  const projection = projectPlain("# 1. Attrition\n\nGroup shall pay eighty percent (80%).");

  it("maps a projected range back onto the wording it came from", () => {
    const at = projection.text.indexOf("eighty percent (80%)");
    const range = toSourceRange(projection, at, at + "eighty percent (80%)".length);
    expect(
      "# 1. Attrition\n\nGroup shall pay eighty percent (80%).".slice(range.start, range.end)
    ).toBe("eighty percent (80%)");
  });

  it("trims the separators standing in for paragraph breaks", () => {
    const at = projection.text.indexOf("Attrition");
    const range = toSourceRange(projection, at + "Attrition".length, at + "Attrition Group".length);
    expect(
      "# 1. Attrition\n\nGroup shall pay eighty percent (80%).".slice(range.start, range.end)
    ).toBe("Group");
  });

  it("answers a zero-width position for an empty range", () => {
    const at = projection.text.indexOf("Group");
    const range = toSourceRange(projection, at, at);
    expect(range.start).toBe(range.end);
  });
});
