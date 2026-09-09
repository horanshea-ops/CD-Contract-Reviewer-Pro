import { describe, expect, it } from "vitest";
import type { RenderedLine } from "@/lib/text-to-pdf";
import {
  reconstructContractText,
  applyProposedChanges,
  buildCleanContractText,
  generateCleanContractPdf,
  type CleanContractFinding,
} from "@/lib/clean-contract-pdf";
import { extractPdfLines } from "@/lib/extract-pdf-lines";

/** Mirrors lib/text-to-pdf.ts's own geometry: 14pt line pitch, 6pt extra between paragraphs. */
const TOP = 736;
const PITCH = 14;

function line(text: string, y: number, pageIndex = 0, x = 56): RenderedLine {
  return { text, pageIndex, x, y, width: text.length * 5, height: PITCH };
}

/** Lays out lines down a page, `true` in the gaps array meaning "start a new paragraph here". */
function flow(entries: { text: string; newParagraph?: boolean }[], pageIndex = 0): RenderedLine[] {
  let y = TOP;
  return entries.map((e, i) => {
    if (i > 0) y -= e.newParagraph ? PITCH + 6 : PITCH;
    return line(e.text, y, pageIndex);
  });
}

function finding(overrides: Partial<CleanContractFinding> = {}): CleanContractFinding {
  return {
    clause_type: "cancellation",
    location_section: null,
    quoted_text: "seventy-five percent (75%) of anticipated revenue",
    language: "fifty percent (50%) of anticipated revenue",
    is_missing_clause: false,
    ...overrides,
  };
}

describe("reconstructContractText", () => {
  it("joins wrapped lines into one paragraph and splits on the wider gap", () => {
    const lines = flow([
      { text: "The Group shall be liable for" },
      { text: "seventy-five percent (75%) of anticipated revenue." },
      { text: "Force majeure applies only to physical damage.", newParagraph: true },
    ]);
    const text = reconstructContractText(lines);
    expect(text).toBe(
      "The Group shall be liable for seventy-five percent (75%) of anticipated revenue.\n\nForce majeure applies only to physical damage."
    );
  });

  it("starts a new paragraph at a page break", () => {
    const text = reconstructContractText([
      ...flow([{ text: "End of the first page." }], 0),
      ...flow([{ text: "Start of the second page." }], 1),
    ]);
    expect(text).toBe("End of the first page.\n\nStart of the second page.");
  });

  it("puts shuffled PDF-style items back into reading order", () => {
    const ordered = flow([
      { text: "First line of the clause." },
      { text: "Second line of the clause." },
      { text: "Third line of the clause." },
    ]);
    const shuffled = [ordered[2], ordered[0], ordered[1]];
    expect(reconstructContractText(shuffled)).toBe(reconstructContractText(ordered));
  });

  it("merges items that share a baseline, left to right", () => {
    const text = reconstructContractText([
      line("of anticipated revenue.", TOP, 0, 200),
      line("The Group shall pay seventy-five percent", TOP, 0, 56),
    ]);
    expect(text).toBe("The Group shall pay seventy-five percent of anticipated revenue.");
  });

  it("drops a running footer that repeats at the same height across pages", () => {
    const lines = [0, 1, 2, 3].flatMap((page) => [
      line(`Body text unique to page ${page}.`, TOP, page),
      line("CONFIDENTIAL - HARBORVIEW GRAND", 40, page),
    ]);
    const text = reconstructContractText(lines);
    expect(text).not.toMatch(/CONFIDENTIAL/);
    expect(text).toContain("Body text unique to page 0.");
    expect(text).toContain("Body text unique to page 3.");
  });

  it("keeps repeated wording that is not page furniture", () => {
    // Same words, but flowing down the page rather than pinned at one height.
    const lines = [0, 1, 2, 3].flatMap((page) => [
      line("Notice shall be given in writing.", TOP - page * 3, page),
      line(`Body text unique to page ${page}.`, TOP - 40, page),
    ]);
    expect(reconstructContractText(lines)).toMatch(/Notice shall be given in writing/);
  });

  it("keeps everything when the document is too short to judge repetition", () => {
    const lines = [0, 1].flatMap((page) => [
      line(`Body ${page}.`, TOP, page),
      line("Page footer", 40, page),
    ]);
    expect(reconstructContractText(lines)).toMatch(/Page footer/);
  });
});

describe("applyProposedChanges", () => {
  const text =
    "The Group shall be liable for seventy-five percent (75%) of anticipated revenue.\n\nThe cutoff date shall be forty-five (45) days prior to arrival.";

  it("substitutes located language in place", () => {
    const result = applyProposedChanges(text, [finding()]);
    expect(result.text).toContain("fifty percent (50%) of anticipated revenue");
    expect(result.text).not.toContain("seventy-five percent (75%)");
    expect(result.applied).toHaveLength(1);
    expect(result.unplaced).toHaveLength(0);
  });

  /**
   * Asserts the whole resulting string, not just that both replacements appear.
   * The first replacement is shorter than what it replaces, so applying the
   * spans in the wrong order shifts the second one and slices the wrong
   * characters — which a pair of toContain checks does not notice.
   */
  it("applies two changes in one document without corrupting either offset", () => {
    const result = applyProposedChanges(text, [
      finding(),
      finding({
        clause_type: "cutoff_date",
        quoted_text: "forty-five (45) days prior to arrival",
        language: "twenty-one (21) days prior to arrival",
      }),
    ]);
    expect(result.applied).toHaveLength(2);
    expect(result.text).toBe(
      "The Group shall be liable for fifty percent (50%) of anticipated revenue.\n\nThe cutoff date shall be twenty-one (21) days prior to arrival."
    );
  });

  it("applies a longer replacement without corrupting a later span", () => {
    const result = applyProposedChanges(text, [
      finding({ language: "fifty percent (50%) of anticipated revenue, less any resold room revenue" }),
      finding({
        clause_type: "cutoff_date",
        quoted_text: "forty-five (45) days prior to arrival",
        language: "twenty-one (21) days prior to arrival",
      }),
    ]);
    expect(result.text).toBe(
      "The Group shall be liable for fifty percent (50%) of anticipated revenue, less any resold room revenue.\n\nThe cutoff date shall be twenty-one (21) days prior to arrival."
    );
  });

  it("matches a quote the model rewrapped and recapitalised", () => {
    const result = applyProposedChanges(text, [
      finding({ quoted_text: "Seventy-Five Percent (75%)\n  Of Anticipated Revenue" }),
    ]);
    expect(result.applied).toHaveLength(1);
    expect(result.text).toContain("fifty percent (50%)");
  });

  it("refuses an ambiguous quote rather than rewriting the wrong clause", () => {
    const repeated =
      "Section 4. The fee shall be thirty percent (30%) of the total.\n\nSection 9. The fee shall be thirty percent (30%) of the total.";
    const result = applyProposedChanges(repeated, [
      finding({ quoted_text: "thirty percent (30%)", language: "ten percent (10%)", location_section: null }),
    ]);
    expect(result.applied).toHaveLength(0);
    expect(result.unplaced).toHaveLength(1);
    expect(result.unplaced[0].reason).toMatch(/appears 2 times/i);
    expect(result.text).toBe(repeated);
  });

  it("reports a quote that is simply not there", () => {
    const result = applyProposedChanges(text, [finding({ quoted_text: "a clause that does not exist anywhere" })]);
    expect(result.unplaced).toHaveLength(1);
    expect(result.text).toBe(text);
  });

  it("routes a missing clause to additions, never to the body", () => {
    const result = applyProposedChanges(text, [
      finding({ clause_type: "walk_relocation", is_missing_clause: true, quoted_text: null, language: "New clause." }),
    ]);
    expect(result.additions).toHaveLength(1);
    expect(result.text).toBe(text);
  });

  it("refuses the second of two overlapping changes instead of interleaving them", () => {
    const result = applyProposedChanges(text, [
      finding({ quoted_text: "seventy-five percent (75%) of anticipated revenue", language: "A" }),
      finding({ clause_type: "attrition", quoted_text: "liable for seventy-five percent", language: "B" }),
    ]);
    expect(result.applied).toHaveLength(1);
    expect(result.unplaced).toHaveLength(1);
    expect(result.unplaced[0].reason).toMatch(/overlaps/i);
  });
});

describe("buildCleanContractText", () => {
  const base = { text: "Body.", applied: [], unplaced: [], additions: [] };

  it("omits both closing sections when there is nothing to put in them", () => {
    expect(buildCleanContractText(base)).toBe("Body.");
  });

  it("adds new clauses under their own heading", () => {
    const out = buildCleanContractText({
      ...base,
      additions: [finding({ clause_type: "walk_relocation", is_missing_clause: true, language: "New clause text." })],
    });
    expect(out).toContain("Additional Proposed Clauses");
    expect(out).toContain("Walk relocation");
    expect(out).toContain("New clause text.");
  });

  it("lists unplaced changes with their language and says the body is unchanged", () => {
    const out = buildCleanContractText({
      ...base,
      unplaced: [{ clause_type: "cancellation", language: "fifty percent (50%)", reason: "ambiguous" }],
    });
    expect(out).toContain("Proposed Changes Not Placed Automatically");
    expect(out).toContain("fifty percent (50%)");
    expect(out).toMatch(/body above is unchanged/i);
  });
});

describe("generateCleanContractPdf", () => {
  const lines = flow([
    { text: "The Group shall be liable for seventy-five percent (75%) of anticipated revenue." },
    { text: "The cutoff date shall be forty-five (45) days prior to arrival.", newParagraph: true },
  ]);

  it("renders the substituted contract and passes its own conservation check", async () => {
    const result = await generateCleanContractPdf({
      lines,
      findings: [finding()],
      title: "Proposed Amended Contract",
    });

    expect(result.conservation.problems).toEqual([]);
    expect(result.conservation.ok).toBe(true);
    expect(result.appliedCount).toBe(1);

    const text = (await extractPdfLines(result.pdfBytes.slice())).map((l) => l.text).join(" ");
    expect(text).toContain("fifty percent (50%)");
    expect(text).not.toContain("seventy-five percent (75%)");
    expect(text).toContain("forty-five (45) days");
  });

  it("runs the forward/backward oracle over more than one substitution", async () => {
    const result = await generateCleanContractPdf({
      lines,
      findings: [
        finding(),
        finding({
          clause_type: "cutoff_date",
          quoted_text: "forty-five (45) days prior to arrival",
          language: "twenty-one (21) days prior to arrival",
        }),
      ],
      title: "Proposed Amended Contract",
    });

    expect(result.appliedCount).toBe(2);
    expect(result.conservation.problems).toEqual([]);

    const text = (await extractPdfLines(result.pdfBytes.slice())).map((l) => l.text).join(" ");
    expect(text).toContain("fifty percent (50%)");
    expect(text).toContain("twenty-one (21) days");
    expect(text).not.toContain("seventy-five");
    expect(text).not.toContain("forty-five");
  });

  it("carries additions and unplaced items into the rendered document", async () => {
    const result = await generateCleanContractPdf({
      lines,
      findings: [
        finding({ clause_type: "walk_relocation", is_missing_clause: true, quoted_text: null, language: "Hotel shall provide comparable lodging." }),
        finding({ quoted_text: "wording that is nowhere in this contract", language: "Replacement wording." }),
      ],
      title: "Proposed Amended Contract",
    });

    expect(result.additions).toHaveLength(1);
    expect(result.unplaced).toHaveLength(1);
    expect(result.conservation.ok).toBe(true);

    const text = (await extractPdfLines(result.pdfBytes.slice())).map((l) => l.text).join(" ");
    expect(text).toContain("Additional Proposed Clauses");
    expect(text).toContain("Hotel shall provide comparable lodging.");
    expect(text).toContain("Proposed Changes Not Placed Automatically");
    expect(text).toContain("Replacement wording.");
  });

  /**
   * §1.8.3's rule applied to the third property-facing document. The type
   * cannot hold severity, rationale or CD's standard, and this proves the
   * rendered bytes carry none of it even when a wider object is forced in.
   */
  it("never renders severity, rationale or CD's internal standard", async () => {
    const polluted = [
      {
        clause_type: "cancellation",
        location_section: null,
        quoted_text: "seventy-five percent (75%) of anticipated revenue",
        language: "fifty percent (50%) of anticipated revenue",
        is_missing_clause: false,

        severity: "high",
        exposure_amount: 42000,
        exposure_basis: "difference between 75% and 50% of projected room revenue",
        finding_text: "Cancellation fee is well above market and CD should push back hard.",
        cd_standard: "CD standard is 50%; CD will not go above 60% without sign-off.",
      },
    ] as unknown as CleanContractFinding[];

    const result = await generateCleanContractPdf({ lines, findings: polluted, title: "Proposed Amended Contract" });
    const text = (await extractPdfLines(result.pdfBytes.slice())).map((l) => l.text).join(" ");

    expect(text).not.toMatch(/42,?000/);
    expect(text).not.toMatch(/above market/i);
    expect(text).not.toMatch(/push back/i);
    expect(text).not.toMatch(/CD standard/i);
    expect(text).not.toMatch(/sign-off/i);
    expect(text).not.toMatch(/\bhigh\b/i);
    expect(text).toContain("fifty percent (50%)");
  });
});

describe("checkContentConservation", () => {
  it("fails when the rendered PDF does not carry everything the document should", async () => {
    const { textToPdf } = await import("@/lib/text-to-pdf");
    const { checkContentConservation } = await import("@/lib/clean-contract-pdf");

    const rendered = "The Group shall be liable for fifty percent (50%).";
    const { pdfBytes } = await textToPdf("Proposed Amended Contract", rendered);

    const report = await checkContentConservation({
      originalText: rendered,
      intendedText: `${rendered} This sentence was never rendered into the file.`,
      title: "Proposed Amended Contract",
      placements: [],
      applied: [],
      pdfBytes,
    });

    expect(report.ok).toBe(false);
    expect(report.problems.join(" ")).toMatch(/does not match the document it was built from/i);
  });

  it("fails when applying the changes forwards and backwards disagree", async () => {
    const { textToPdf } = await import("@/lib/text-to-pdf");
    const { checkContentConservation } = await import("@/lib/clean-contract-pdf");

    const original = "The Group shall be liable for seventy-five percent (75%).";
    const intended = "The Group shall be liable for fifty percent (50%).";
    const { pdfBytes } = await textToPdf("Proposed Amended Contract", intended);

    const report = await checkContentConservation({
      originalText: original,
      intendedText: intended,
      title: "Proposed Amended Contract",
      // Offsets that do not correspond to the substitution actually made.
      placements: [{ start: 0, end: 3, language: "WRONG" }],
      applied: [],
      pdfBytes,
    });

    expect(report.ok).toBe(false);
    expect(report.problems.join(" ")).toMatch(/offset is wrong/i);
  });

  it("fails when a change reported as applied is not in the text", async () => {
    const { textToPdf } = await import("@/lib/text-to-pdf");
    const { checkContentConservation } = await import("@/lib/clean-contract-pdf");

    const text = "The Group shall be liable for fifty percent (50%).";
    const { pdfBytes } = await textToPdf("Proposed Amended Contract", text);

    const report = await checkContentConservation({
      originalText: text,
      intendedText: text,
      title: "Proposed Amended Contract",
      placements: [],
      applied: [finding({ language: "language that never made it into the document" })],
      pdfBytes,
    });

    expect(report.ok).toBe(false);
    expect(report.problems.join(" ")).toMatch(/is not present in the output/i);
  });
});
