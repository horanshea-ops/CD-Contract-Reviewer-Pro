import { describe, expect, it } from "vitest";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { NumberingResolver, isSynthetic, loadDocx, normalizeChar, walkPart } from "@/lib/docx";
import type { SourceRef } from "@/lib/docx";

/**
 * The two things §1.5 needs from §1.4's map, and neither is checked elsewhere.
 *
 * `runs[runIndex]` must be the element the character actually came from — §1.5
 * splits and wraps that element, so if the index is off by one it edits the
 * wrong wording and nothing downstream would notice. And a character inside a
 * table has to say which cell, because a change confined to one cell is edited
 * in place while one spanning cells replaces the whole table.
 */

const FIXTURES = path.join("tests", "fixtures");

async function walkFixture(file: string) {
  const pkg = await loadDocx(await readFile(path.join(FIXTURES, file)));
  const numbering = new NumberingResolver(pkg.numbering);
  return pkg.textParts.map((p) => walkPart(p, numbering));
}

/** The run's raw text, as the walker read it. */
function runText(run: Element): string {
  let out = "";
  for (let i = 0; i < run.childNodes.length; i++) {
    const c = run.childNodes[i];
    if (c.nodeType !== 1) continue;
    const name = (c as Element).nodeName;
    if (name === "w:t" || name === "w:delText") out += c.textContent ?? "";
  }
  return out;
}

const FIXTURE_FILES = (await readdir(FIXTURES)).filter((f) => f.endsWith(".docx")).sort();

describe("run index resolves to the right element", () => {
  it.each(FIXTURE_FILES)("%s maps every character back to its own run", async (name) => {
    for (const part of await walkFixture(name)) {
      expect(part.runs).toHaveLength(part.runCount);

      for (let i = 0; i < part.text.length; i++) {
        const entry = part.map[i];
        if (isSynthetic(entry)) continue;
        const ref = entry as SourceRef;
        const run = part.runs[ref.runIndex];
        expect(run, `${part.part} char ${i} has no run`).toBeTruthy();
        // The character at that offset in the run's original text must
        // normalise to exactly the character the model reads.
        expect(normalizeChar(runText(run)[ref.offsetWithinRun])).toBe(part.text[i]);
      }
    }
  });
});

describe("table and cell identity", () => {
  it("gives every character inside a table a cell, and everything else none", async () => {
    const [document] = await walkFixture("02-heavy-tables.docx");
    let inTable = 0;
    let outside = 0;

    for (const entry of document.map) {
      if (isSynthetic(entry)) continue;
      const ref = entry as SourceRef;
      if (ref.insideTable) {
        expect(ref.tableIndex).not.toBeNull();
        expect(ref.cellIndex).not.toBeNull();
        inTable++;
      } else {
        expect(ref.tableIndex).toBeNull();
        expect(ref.cellIndex).toBeNull();
        outside++;
      }
    }
    expect(inTable).toBeGreaterThan(0);
    expect(outside).toBeGreaterThan(0);
  });

  it("tells one cell from another, which is what decides in-place versus whole-table", async () => {
    const [document] = await walkFixture("02-heavy-tables.docx");
    const cells = new Set<number>();
    for (const entry of document.map) {
      if (isSynthetic(entry)) continue;
      const ref = entry as SourceRef;
      if (ref.cellIndex !== null) cells.add(ref.cellIndex);
    }
    expect(cells.size).toBeGreaterThan(3);
  });

  it("numbers tables in the same order the DOM reports them, nesting included", async () => {
    const pkg = await loadDocx(await readFile(path.join(FIXTURES, "13-nested-merged-tables.docx")));
    const numbering = new NumberingResolver(pkg.numbering);
    const [document] = pkg.textParts.map((p) => walkPart(p, numbering));

    const seen = new Set<number>();
    for (const entry of document.map) {
      if (isSynthetic(entry)) continue;
      const ref = entry as SourceRef;
      if (ref.tableIndex !== null) seen.add(ref.tableIndex);
    }
    // §1.6's table-shape check indexes tables by getElementsByTagName order, so
    // the map has to agree with it or the two describe different tables.
    const domCount = pkg.document.doc.getElementsByTagName("w:tbl").length;
    expect(domCount).toBeGreaterThan(1);
    for (const index of seen) expect(index).toBeLessThan(domCount);
  });
});
