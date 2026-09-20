import { describe, expect, it } from "vitest";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { extractDocx } from "@/lib/docx";
import type { ExtractedPart } from "@/lib/docx";
import {
  AcceptedViewDrift,
  authorsIn,
  classifyAuthor,
  fateOfOurChanges,
  revisionMarks,
} from "@/lib/round-diff/attribution";
import type { DiffRegion } from "@/lib/round-diff/diff";
import { buildDocx, del, delRun, ins, para, run } from "../helpers/docx-package";

/**
 * Who changed what, read off Word's revision marks (MASTER_PLAN.md §2.1.1).
 *
 * The corpus test below is the offset guard for this section. Markup spans and
 * accepted-view text are appended in one walk, so rebuilding the text from the
 * spans must reproduce it character for character. If it ever stops doing so,
 * every author attribution after the drift is wrong and nothing else here
 * would notice.
 */

const documentOf = async (bytes: Uint8Array) => (await extractDocx(bytes)).document;

describe("revisionMarks", () => {
  it("rebuilds the accepted view exactly, on every part of every fixture", async () => {
    const files = (await readdir(path.join("tests", "fixtures"))).filter((f) => f.endsWith(".docx"));
    expect(files.length).toBeGreaterThan(10);

    for (const file of files.sort()) {
      const extracted = await extractDocx(await readFile(path.join("tests", "fixtures", file)));
      for (const part of extracted.parts) {
        // Throws on any drift; the assertion is that it does not.
        expect(() => revisionMarks(part), `${file} / ${part.part}`).not.toThrow();
      }
    }
  });

  it("places an insertion over the wording it added", async () => {
    const bytes = await buildDocx(
      para(`${run("Group shall pay ")}${ins(1, "Jane Associate", run("seventy percent (70%)"))}${run(" of the shortfall.")}`)
    );
    const part = await documentOf(bytes);
    const marks = revisionMarks(part);

    expect(marks).toHaveLength(1);
    expect(part.text.slice(marks[0].start, marks[0].end)).toBe("seventy percent (70%)");
    expect(marks[0].revision.author).toBe("Jane Associate");
    expect(marks[0].revision.kind).toBe("ins");
  });

  it("places a deletion at a point, carrying the wording it took out", async () => {
    const bytes = await buildDocx(
      para(`${run("Group shall pay ")}${del(2, "Hotel Counsel", delRun("eighty percent (80%)"))}${run(" of the shortfall.")}`)
    );
    const part = await documentOf(bytes);
    const marks = revisionMarks(part);

    expect(marks).toHaveLength(1);
    expect(marks[0].start).toBe(marks[0].end);
    expect(marks[0].text).toBe("eighty percent (80%)");
    expect(part.text.slice(0, marks[0].start)).toBe("Group shall pay ");
  });

  it("keeps two authors apart in one paragraph", async () => {
    const bytes = await buildDocx(
      para(
        [
          run("Attrition is measured "),
          ins(1, "Jane Associate", run("cumulatively")),
          del(2, "Hotel Counsel", delRun("night by night")),
          run(" across the block."),
        ].join("")
      )
    );
    const marks = revisionMarks(await documentOf(bytes));
    expect(marks.map((m) => m.revision.author)).toEqual(["Jane Associate", "Hotel Counsel"]);
  });

  it("throws rather than report offsets it cannot stand behind", () => {
    const drifted = {
      part: "document",
      text: "the real accepted view",
      map: [],
      originalText: "",
      markup: [{ text: "something else entirely", revision: null, synthetic: true }],
    } as unknown as ExtractedPart;

    expect(() => revisionMarks(drifted)).toThrow(AcceptedViewDrift);
  });
});

describe("authorsIn", () => {
  it("names only the authors whose changes touch the range asked about", async () => {
    const bytes = await buildDocx(
      [
        para(`${run("First. ")}${ins(1, "Jane Associate", run("Ours here."))}`),
        para(`${run("Second. ")}${ins(2, "Hotel Counsel", run("Theirs here."))}`),
      ].join("")
    );
    const part = await documentOf(bytes);
    const marks = revisionMarks(part);

    const ourStart = part.text.indexOf("Ours here.");
    const theirStart = part.text.indexOf("Theirs here.");

    expect(authorsIn(marks, { start: ourStart, end: ourStart + 4 })).toEqual(["Jane Associate"]);
    expect(authorsIn(marks, { start: theirStart, end: theirStart + 4 })).toEqual(["Hotel Counsel"]);
    expect(authorsIn(marks, { start: 0, end: 5 })).toEqual([]);
  });

  it("catches a deletion sitting inside the range even though it has no width", async () => {
    const bytes = await buildDocx(
      para(`${run("Group shall pay ")}${del(2, "Hotel Counsel", delRun("eighty"))}${run(" the shortfall.")}`)
    );
    const part = await documentOf(bytes);
    const at = part.text.indexOf("pay ") + 4;

    expect(authorsIn(revisionMarks(part), { start: at - 2, end: at + 2 })).toEqual(["Hotel Counsel"]);
  });
});

describe("classifyAuthor", () => {
  const ours = ["Jane Associate"];

  it("tells our associates from the counterparty", () => {
    expect(classifyAuthor("Jane Associate", ours)).toBe("ours");
    expect(classifyAuthor("  jane   associate ", ours)).toBe("ours");
    expect(classifyAuthor("Hotel Counsel", ours)).toBe("theirs");
  });

  it("keeps an unnamed author separate from the counterparty", () => {
    expect(classifyAuthor("", ours)).toBe("unknown");
    expect(classifyAuthor("   ", ours)).toBe("unknown");
  });
});

describe("fateOfOurChanges", () => {
  const marks = [
    {
      start: 10,
      end: 30,
      text: "seventy percent (70%)",
      revision: { kind: "ins" as const, author: "Jane Associate", date: "", id: "1" },
    },
  ];
  const region = (over: Partial<DiffRegion>): DiffRegion => ({
    kind: "delete",
    baseline: { start: 0, end: 0 },
    returned: { start: 0, end: 0 },
    baselineText: "",
    returnedText: "",
    ...over,
  });

  it("reports a change nothing touched as fully retained", () => {
    const fate = fateOfOurChanges(marks, ["Jane Associate"], [region({ baseline: { start: 40, end: 50 } })]);
    expect(fate[0].retained).toBe(1);
  });

  it("reports a change struck out entirely as gone", () => {
    const fate = fateOfOurChanges(marks, ["Jane Associate"], [region({ baseline: { start: 5, end: 35 } })]);
    expect(fate[0].retained).toBe(0);
  });

  it("reports a change half rewritten as half retained", () => {
    const fate = fateOfOurChanges(marks, ["Jane Associate"], [
      region({ kind: "replace", baseline: { start: 20, end: 30 } }),
    ]);
    expect(fate[0].retained).toBe(0.5);
  });

  it("ignores an insertion elsewhere, which takes nothing out", () => {
    const fate = fateOfOurChanges(marks, ["Jane Associate"], [
      region({ kind: "insert", baseline: { start: 15, end: 15 } }),
    ]);
    expect(fate[0].retained).toBe(1);
  });

  it("says nothing about the counterparty's own insertions", () => {
    expect(fateOfOurChanges(marks, ["Someone Else"], [])).toEqual([]);
  });
});
