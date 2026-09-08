import { describe, expect, it } from "vitest";
import { XMLSerializer } from "@xmldom/xmldom";
import { NumberingResolver, loadDocx, walkPart, type WalkResult } from "@/lib/docx";
import { runText, runsForSpan, splitRun } from "@/lib/redline-engine/runs";
import { locateQuote } from "@/lib/redline-engine/locate";
import { isLocated } from "@/lib/redline-engine/types";
import { buildDocx, para, run } from "../helpers/docx-package";

/**
 * Splitting runs at a span's boundaries (MASTER_PLAN.md §1.5.4).
 *
 * Two failures to guard against, both silent. Formatting drops when `w:rPr` is
 * not cloned into every piece, and tabs, breaks and footnote markers vanish
 * when a boundary lands next to one — the defect §1.6's oracle found in the
 * engine this replaces.
 */

async function walk(bytes: Uint8Array | Buffer): Promise<WalkResult[]> {
  const pkg = await loadDocx(bytes);
  return pkg.textParts.map((p) => walkPart(p, new NumberingResolver(pkg.numbering)));
}

// xmldom's serializer takes its own node type, not the DOM lib's.
type SerializableNode = Parameters<XMLSerializer["serializeToString"]>[0];
const xml = (el: Element) => new XMLSerializer().serializeToString(el as unknown as SerializableNode);

async function coverFor(body: string, quote: string) {
  const parts = await walk(await buildDocx(body));
  const span = locateQuote(parts, quote, null);
  if (!isLocated(span)) throw new Error(`could not locate "${quote}"`);
  const part = parts.find((p) => p.part === span.part)!;
  return { part, covered: runsForSpan(part, span) };
}

const BOLD = `<w:rPr><w:b/><w:i/><w:color w:val="FF0000"/></w:rPr>`;

describe("splitting one run", () => {
  it("covers exactly the quoted wording and nothing either side", async () => {
    const { covered } = await coverFor(
      para(run("Group shall be liable for eighty percent (80%) of the group rate.")),
      "eighty percent (80%)"
    );
    expect(covered.map(runText).join("")).toBe("eighty percent (80%)");
  });

  it("leaves the text either side in place", async () => {
    const { part, covered } = await coverFor(
      para(run("Group shall be liable for eighty percent (80%) of the group rate.")),
      "eighty percent (80%)"
    );
    const paragraph = covered[0].parentNode as Element;
    expect(paragraph.textContent).toBe("Group shall be liable for eighty percent (80%) of the group rate.");
    expect(part).toBeTruthy();
  });

  it("clones the run's formatting into every piece", async () => {
    // The single line §1.5.4 warns about. Without it the words either side of
    // an edit quietly lose their bold, italic and colour.
    const { covered } = await coverFor(
      para(`<w:r>${BOLD}<w:t xml:space="preserve">Group shall pay eighty percent (80%) of the rate.</w:t></w:r>`),
      "eighty percent (80%)"
    );
    const paragraph = covered[0].parentNode as Element;
    const pieces = xml(paragraph).match(/<w:r>/g) ?? [];
    expect(pieces.length).toBe(3);
    expect((xml(paragraph).match(/<w:b\/>/g) ?? []).length).toBe(3);
    expect((xml(paragraph).match(/w:val="FF0000"/g) ?? []).length).toBe(3);
  });
});

describe("splitting across runs", () => {
  it("covers whole runs in the middle and part-runs at each end", async () => {
    const { covered } = await coverFor(
      para(run("Group shall be liable for ") + run("eighty percent") + run(" (80%) of the rate.")),
      "for eighty percent (80%)"
    );
    expect(covered.map(runText).join("")).toBe("for eighty percent (80%)");
  });

  it("keeps a tab that sits inside the quoted wording", async () => {
    // The engine this replaces destroyed anything between the first and last
    // matched run. A tab is invisible in the text and very visible in Word.
    const { covered } = await coverFor(
      para(run("Deposit schedule") + `<w:r><w:tab/></w:r>` + run("fifty percent (50%) on signing")),
      "schedule \t fifty percent (50%)"
    );
    expect(covered.some((r) => xml(r).includes("<w:tab/>"))).toBe(true);
  });

  it("keeps a tab that sits at the very end of a split run", async () => {
    // The boundary case: the span reaches the run's last character, so the tab
    // has nowhere obvious to go and is the easiest thing in the file to lose.
    const body = para(`<w:r><w:t xml:space="preserve">Balance due</w:t><w:tab/></w:r>` + run("on signing"));
    const { covered } = await coverFor(body, "Balance due");
    const paragraph = covered[0].parentNode as Element;
    expect(xml(paragraph)).toContain("<w:tab/>");
  });
});

describe("splitRun on its own", () => {
  it("puts every child in exactly one piece", async () => {
    const parts = await walk(
      await buildDocx(para(`<w:r>${BOLD}<w:t xml:space="preserve">abcdef</w:t><w:tab/></w:r>`))
    );
    const target = parts[0].runs[0];
    const { before, middle, after } = splitRun(target, 2, 4);

    expect(runText(before!)).toBe("ab");
    expect(runText(middle)).toBe("cd");
    expect(runText(after!)).toBe("ef");
    // The trailing tab goes with the last piece rather than disappearing.
    // Serialised detached, so xmldom prints the namespace it would inherit
    // in the tree — hence the open-tag match rather than the exact element.
    expect(xml(after!)).toContain("<w:tab");
    expect(xml(before!)).not.toContain("<w:tab");
    expect(xml(middle)).not.toContain("<w:tab");
  });

  it("handles a run whose text is spread over several children", async () => {
    const parts = await walk(
      await buildDocx(para(`<w:r><w:t xml:space="preserve">Deposit </w:t><w:t xml:space="preserve">schedule</w:t></w:r>`))
    );
    const { before, middle, after } = splitRun(parts[0].runs[0], 8, 16);

    expect(runText(before!)).toBe("Deposit ");
    expect(runText(middle)).toBe("schedule");
    expect(after).toBeNull();
  });
});
