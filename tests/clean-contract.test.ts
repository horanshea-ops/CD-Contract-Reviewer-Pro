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

  it("collapses a running header and footer to a single occurrence", () => {
    const lines = [0, 1, 2, 3].flatMap((page) => [
      line("HARBORVIEW GRAND - GROUP AGREEMENT", TOP, page),
      line(`Body text unique to page ${page}.`, TOP - PITCH, page),
      line("Notice shall be given in writing.", TOP - PITCH * 2, page),
      line("Payment is due on receipt.", TOP - PITCH * 3, page),
      line("CONFIDENTIAL - HARBORVIEW GRAND", 40, page),
    ]);
    const text = reconstructContractText(lines);
    // Kept once rather than removed outright — an unchanging repeated line at a
    // page edge might be a table header continued across pages, and dropping
    // one of those would lose content.
    expect(text.match(/CONFIDENTIAL/g)).toHaveLength(1);
    expect(text.match(/GROUP AGREEMENT/g)).toHaveLength(1);
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

/**
 * Tables and awkward layout. §1.4's live check found the model reads
 * cancellation schedules and attrition scales as real grids, and those carry
 * the largest dollar figures in a contract — so a row flattened into the wrong
 * order or a cell dropped is the most expensive silent error available here.
 */
describe("tables and awkward layout", () => {
  /** One table row: cells share a baseline and differ in x. */
  function row(cells: { text: string; x: number }[], y: number, page = 0): RenderedLine[] {
    return cells.map((c) => line(c.text, y, page, c.x));
  }

  const schedule = [
    ...row([{ text: "Days Prior to Arrival", x: 56 }, { text: "Damages (% of Room Revenue)", x: 300 }], TOP),
    ...row([{ text: "365 or more", x: 56 }, { text: "25%", x: 300 }], TOP - PITCH),
    ...row([{ text: "180 to 364", x: 56 }, { text: "50%", x: 300 }], TOP - PITCH * 2),
    ...row([{ text: "90 to 179", x: 56 }, { text: "75%", x: 300 }], TOP - PITCH * 3),
  ];

  it("keeps each table row on its own line, cells in left-to-right order", () => {
    const text = reconstructContractText(schedule);
    expect(text).toBe(
      "Days Prior to Arrival Damages (% of Room Revenue) 365 or more 25% 180 to 364 50% 90 to 179 75%"
    );
  });

  it("does not lose a cell when the row is delivered out of order", () => {
    const shuffled = [schedule[5], schedule[0], schedule[3], schedule[1], schedule[7], schedule[2], schedule[6], schedule[4]];
    expect(reconstructContractText(shuffled)).toBe(reconstructContractText(schedule));
  });

  it("keeps a wide column gap from splitting a row", () => {
    const wide = row([{ text: "Attrition threshold", x: 56 }, { text: "90%", x: 520 }], TOP);
    expect(reconstructContractText(wide)).toBe("Attrition threshold 90%");
  });

  it("handles the pipe separators §1.4's extractor emits for table cells", () => {
    const piped = [
      line("Days Prior to Arrival | Damages", TOP),
      line("365 or more | 25%", TOP - PITCH),
      line("180 to 364 | 50%", TOP - PITCH * 2),
    ];
    const result = applyProposedChanges(reconstructContractText(piped), [
      finding({ clause_type: "cancellation", quoted_text: "365 or more | 25%", language: "365 or more | 15%" }),
    ]);
    expect(result.applied).toHaveLength(1);
    expect(result.text).toContain("365 or more | 15%");
    expect(result.text).toContain("180 to 364 | 50%");
  });

  it("substitutes a value that spans two cells of the same row", () => {
    const result = applyProposedChanges(reconstructContractText(schedule), [
      finding({ clause_type: "cancellation", quoted_text: "90 to 179 75%", language: "90 to 179 40%" }),
    ]);
    expect(result.applied).toHaveLength(1);
    expect(result.text).toContain("90 to 179 40%");
    expect(result.text).not.toContain("90 to 179 75%");
    expect(result.text).toContain("180 to 364 50%");
  });

  it("refuses a bare percentage that appears in more than one row", () => {
    const repeated = [
      ...row([{ text: "365 or more", x: 56 }, { text: "50%", x: 300 }], TOP),
      ...row([{ text: "180 to 364", x: 56 }, { text: "50%", x: 300 }], TOP - PITCH),
    ];
    const result = applyProposedChanges(reconstructContractText(repeated), [
      finding({ clause_type: "cancellation", quoted_text: "50%", language: "30%" }),
    ]);
    expect(result.applied).toHaveLength(0);
    expect(result.unplaced[0].reason).toMatch(/appears 2 times/i);
  });

  it("keeps a footnote marker on the line it belongs to", () => {
    const text = reconstructContractText([
      line("The service charge is 22", TOP, 0, 56),
      line("1", TOP + 4, 0, 170),
      line("percent of the total.", TOP, 0, 180),
    ]);
    expect(text).toBe("The service charge is 22 1 percent of the total.");
  });

  it("ignores whitespace-only items rather than leaving gaps in the text", () => {
    const text = reconstructContractText([
      line("The Group shall pay.", TOP),
      line("   ", TOP - PITCH),
      line("Notice is required.", TOP - PITCH * 2),
    ]);
    expect(text).toBe("The Group shall pay. Notice is required.");
  });

  it("drops page numbers even though the number changes on every page", () => {
    const lines = [0, 1, 2, 3].flatMap((page) => [
      line(`Clause ${page * 2 + 1}. The Group shall perform each of its obligations under this Agreement.`, TOP, page),
      line(`Clause ${page * 2 + 2}. Notice in writing.`, TOP - PITCH, page),
      line("Payment is due on receipt.", TOP - PITCH * 2, page),
      line("Rates are confirmed.", TOP - PITCH * 3, page),
      line(`Page ${page + 1} of 4`, 40, page, 480),
    ]);
    const text = reconstructContractText(lines);
    expect(text).not.toMatch(/Page \d of 4/);
    expect(text).toContain("Clause 1.");
    expect(text).toContain("Clause 8.");
    expect(text).toContain("Payment is due on receipt.");
  });

  it("keeps body wording that repeats on every page but is not at an edge", () => {
    const lines = [0, 1, 2, 3].flatMap((page) => [
      line("HEADER", TOP, page),
      line("Payment is due on receipt.", TOP - PITCH, page),
      line(`Clause ${page}. Unique wording here.`, TOP - PITCH * 2, page),
      line("Further unique wording.", TOP - PITCH * 3, page),
      line("FOOTER", 40, page),
    ]);
    const text = reconstructContractText(lines);
    expect(text.match(/HEADER/g)).toHaveLength(1);
    expect(text.match(/FOOTER/g)).toHaveLength(1);
    expect(text.match(/Payment is due on receipt/g)).toHaveLength(4);
  });

  it("keeps a repeated opening line that is too long to be a running head", () => {
    const lines = [0, 1, 2, 3].flatMap((page) => [
      line(
        "The Group shall perform each of its obligations under this Agreement in full and on time.",
        TOP,
        page
      ),
      line(`Clause ${page}. Unique wording.`, TOP - PITCH, page),
      line("Payment is due on receipt.", TOP - PITCH * 2, page),
      line("Further wording here.", TOP - PITCH * 3, page),
      line(`Page ${page + 1} of 4`, 40, page, 480),
    ]);
    const text = reconstructContractText(lines);
    expect(text).not.toMatch(/Page \d of 4/);
    expect(text.match(/The Group shall perform each of its obligations/g)).toHaveLength(4);
  });

  /**
   * A page holding only a couple of widely separated lines would otherwise make
   * that whole distance look like the document's normal line spacing, and every
   * paragraph break in the contract would disappear.
   */
  it("still finds paragraph breaks on a sparse page", () => {
    const text = reconstructContractText([
      line("A single line near the top of the page.", TOP),
      line("Another line far below it.", 60),
    ]);
    expect(text).toBe("A single line near the top of the page.\n\nAnother line far below it.");
  });

  it("keeps a repeated line when the document is too short to call it furniture", () => {
    const lines = [0, 1].flatMap((page) => [line(`Body ${page}.`, TOP, page), line("Page footer", 40, page)]);
    expect(reconstructContractText(lines)).toMatch(/Page footer/);
  });

  it("preserves numbered and lettered clause markers", () => {
    const text = reconstructContractText([
      line("(a) The Group shall provide notice; and", TOP),
      line("(b) the Hotel shall confirm receipt.", TOP - PITCH),
      line("2.1 Cancellation.", TOP - PITCH - 20, 0),
    ]);
    expect(text).toContain("(a) The Group shall provide notice; and (b) the Hotel shall confirm receipt.");
    expect(text).toContain("2.1 Cancellation.");
  });

  it("keeps a signature block's rule characters intact", () => {
    const text = reconstructContractText([
      ...row([{ text: "____________________", x: 56 }, { text: "____________________", x: 340 }], TOP),
      ...row([{ text: "Group Representative", x: 56 }, { text: "Hotel Representative", x: 340 }], TOP - PITCH),
    ]);
    expect(text).toBe("____________________ ____________________ Group Representative Hotel Representative");
  });

  /**
   * Contracts are set in one column, so cells sharing a baseline are merged as
   * a table row. A genuine two-column layout is therefore interleaved rather
   * than read down each column. No content is lost, which is the agreed bar,
   * but the order is wrong — recorded here so the behaviour is known rather
   * than discovered.
   */
  it("interleaves a true two-column layout, a known limitation", () => {
    const text = reconstructContractText([
      line("Left column first line.", TOP, 0, 56),
      line("Right column first line.", TOP, 0, 340),
      line("Left column second line.", TOP - PITCH, 0, 56),
      line("Right column second line.", TOP - PITCH, 0, 340),
    ]);
    expect(text).toBe(
      "Left column first line. Right column first line. Left column second line. Right column second line."
    );
  });

  it("carries a table substitution through to the rendered PDF with the gate clean", async () => {
    const result = await generateCleanContractPdf({
      lines: schedule,
      findings: [finding({ clause_type: "cancellation", quoted_text: "365 or more 25%", language: "365 or more 10%" })],
      title: "Proposed Amended Contract",
    });

    expect(result.conservation.problems).toEqual([]);
    expect(result.appliedCount).toBe(1);

    const text = (await extractPdfLines(result.pdfBytes.slice())).map((l) => l.text).join(" ");
    expect(text).toContain("365 or more 10%");
    expect(text).toContain("180 to 364 50%");
    expect(text).toContain("90 to 179 75%");
    expect(text).not.toContain("365 or more 25%");
  });

  it("keeps currency and percent symbols through substitution and rendering", async () => {
    const money = [
      line("The F&B minimum is $45,000 for the Event.", TOP),
      line("A service charge of 22% applies.", TOP - PITCH),
    ];
    const result = await generateCleanContractPdf({
      lines: money,
      findings: [finding({ clause_type: "fb_minimum", quoted_text: "$45,000", language: "$30,000" })],
      title: "Proposed Amended Contract",
    });

    expect(result.conservation.problems).toEqual([]);
    const text = (await extractPdfLines(result.pdfBytes.slice())).map((l) => l.text).join(" ");
    expect(text).toContain("$30,000");
    expect(text).toContain("22%");
    expect(text).toContain("F&B");
  });
});

/**
 * Second pass over table and formatting behaviour, covering what real Word and
 * Acrobat output throws at this that the first pass did not reach.
 */
describe("Word and Acrobat artefacts", () => {
  function row(cells: { text: string; x: number }[], y: number, page = 0): RenderedLine[] {
    return cells.map((c) => line(c.text, y, page, c.x));
  }

  it("keeps a table header that repeats at the top of each continuation page, once", () => {
    const lines = [0, 1, 2, 3].flatMap((page) => [
      line("Days Prior | Damages", TOP, page),
      line(`${365 - page * 90} or more | ${25 + page * 10}%`, TOP - PITCH, page),
      line(`Continuation row b on page ${page} of the schedule.`, TOP - PITCH * 2, page),
      line(`Continuation row c on page ${page} of the schedule.`, TOP - PITCH * 3, page),
      line(`Page ${page + 1} of 4`, 40, page, 480),
    ]);
    const text = reconstructContractText(lines);
    expect(text.match(/Days Prior \| Damages/g)).toHaveLength(1);
    expect(text).not.toMatch(/Page \d of 4/);
    expect(text).toContain("365 or more | 25%");
    expect(text).toContain("95 or more | 55%");
  });

  it("matches a straight-quoted quote against curly quotes in the contract", () => {
    const doc = [line("The “Group” shall pay seventy‑five percent (75%).", TOP)];
    const result = applyProposedChanges(reconstructContractText(doc), [
      finding({ quoted_text: 'The "Group" shall pay seventy-five percent (75%).', language: 'The "Group" shall pay fifty percent (50%).' }),
    ]);
    expect(result.applied).toHaveLength(1);
    expect(result.text).toContain("fifty percent (50%)");
  });

  it("matches across a non-breaking space and a non-breaking hyphen", () => {
    const doc = [line("The rate is $259.00 for seventy‑five rooms.", TOP)];
    const result = applyProposedChanges(reconstructContractText(doc), [
      finding({
        quoted_text: "The rate is $259.00 for seventy-five rooms.",
        language: "The rate is $229.00 for seventy-five rooms.",
      }),
    ]);
    expect(result.applied).toHaveLength(1);
    expect(result.text).toContain("$229.00");
  });

  /**
   * lib/docx/normalize.ts folds hyphen-like characters but leaves en and em
   * dashes alone, since they carry meaning a hyphen does not. A quote differing
   * by one such character still matches on the fuzzy tier, which is set at 0.95
   * similarity — so ordinary dash rewriting by the model is absorbed.
   */
  it("absorbs a single en dash difference on the fuzzy tier", () => {
    const doc = [line("Rooms 100–200 are held at the group rate.", TOP)];
    const result = applyProposedChanges(reconstructContractText(doc), [
      finding({ quoted_text: "Rooms 100-200 are held at the group rate.", language: "REPLACED." }),
    ]);
    expect(result.applied).toHaveLength(1);
    expect(result.text).toBe("REPLACED.");
  });

  /**
   * Enough typographic differences at once do fall below that threshold, and
   * the change is then listed rather than applied to approximately the right
   * text. Listing is the safe direction, and this records where the line sits.
   */
  it("lists a quote that drifts too far to match confidently", () => {
    const doc = [line("Rooms 100–200 — rate $259.00 per night, plus tax.", TOP)];
    const result = applyProposedChanges(reconstructContractText(doc), [
      finding({ quoted_text: "Suites 100-200 -- rate $259.00 nightly, plus tax and fees.", language: "REPLACED." }),
    ]);
    expect(result.applied).toHaveLength(0);
    expect(result.unplaced).toHaveLength(1);
    expect(result.text).toContain("Rooms 100–200");
  });

  it("matches text carrying a soft hyphen or zero-width space", () => {
    const doc = [line("The attri­tion thresh​old is 90%.", TOP)];
    const result = applyProposedChanges(reconstructContractText(doc), [
      finding({ clause_type: "attrition", quoted_text: "The attrition threshold is 90%.", language: "The attrition threshold is 80%." }),
    ]);
    expect(result.applied).toHaveLength(1);
    expect(result.text).toBe("The attrition threshold is 80%.");
  });

  it("substitutes a quote that spans a paragraph break", () => {
    const doc = [line("The Group shall be liable", TOP), line("for the full amount due.", TOP - PITCH - 20)];
    const result = applyProposedChanges(reconstructContractText(doc), [
      finding({ quoted_text: "The Group shall be liable for the full amount due.", language: "The Group shall be liable for its documented losses." }),
    ]);
    expect(result.applied).toHaveLength(1);
    expect(result.text).toContain("its documented losses");
  });

  it("substitutes a quote that spans a page break", () => {
    const doc = [line("The Group shall be liable", TOP, 0), line("for the full amount due.", TOP, 1)];
    const result = applyProposedChanges(reconstructContractText(doc), [
      finding({ quoted_text: "The Group shall be liable for the full amount due.", language: "The Group shall be liable for its documented losses." }),
    ]);
    expect(result.applied).toHaveLength(1);
    expect(result.text).toContain("its documented losses");
  });

  it("matches across a tab between words", () => {
    const doc = [line("Attrition\tthreshold\t90%", TOP)];
    const result = applyProposedChanges(reconstructContractText(doc), [
      finding({ clause_type: "attrition", quoted_text: "Attrition threshold 90%", language: "Attrition threshold 80%" }),
    ]);
    expect(result.applied).toHaveLength(1);
    expect(result.text).toBe("Attrition threshold 80%");
  });

  it("keeps a right-aligned numeric column with the row it belongs to", () => {
    const text = reconstructContractText([
      ...row([{ text: "365 or more", x: 56 }, { text: "25%", x: 520 }], TOP),
      ...row([{ text: "180 to 364", x: 56 }, { text: "100%", x: 512 }], TOP - PITCH),
    ]);
    expect(text).toBe("365 or more 25% 180 to 364 100%");
  });

  it("does not invent a cell when a row has an empty one", () => {
    const text = reconstructContractText([
      ...row([{ text: "Deposit", x: 56 }, { text: "Due at signing", x: 300 }], TOP),
      ...row([{ text: "Final payment", x: 56 }], TOP - PITCH),
      ...row([{ text: "Cancellation", x: 56 }, { text: "Per schedule", x: 300 }], TOP - PITCH * 2),
    ]);
    expect(text).toBe("Deposit Due at signing Final payment Cancellation Per schedule");
  });

  it("joins a list marker delivered as its own item to the text it labels", () => {
    const text = reconstructContractText([
      line("1.", TOP, 0, 56),
      line("The Group shall provide notice.", TOP, 0, 80),
      line("2.", TOP - PITCH, 0, 56),
      line("The Hotel shall confirm receipt.", TOP - PITCH, 0, 80),
    ]);
    expect(text).toBe("1. The Group shall provide notice. 2. The Hotel shall confirm receipt.");
  });

  it("refuses a quote matching two identical table rows", () => {
    const text = reconstructContractText([
      ...row([{ text: "Deposit due", x: 56 }, { text: "50%", x: 300 }], TOP),
      ...row([{ text: "Interim payment", x: 56 }, { text: "25%", x: 300 }], TOP - PITCH),
      ...row([{ text: "Deposit due", x: 56 }, { text: "50%", x: 300 }], TOP - PITCH * 2),
    ]);
    const result = applyProposedChanges(text, [
      finding({ quoted_text: "Deposit due 50%", language: "Deposit due 25%" }),
    ]);
    expect(result.applied).toHaveLength(0);
    expect(result.unplaced[0].reason).toMatch(/appears 2 times/i);
  });

  it("picks the right one of two identical rows when a section reference separates them", () => {
    const text = "4. Deposit Terms\n\nDeposit due 50%\n\n9. Interim Terms\n\nDeposit due 50%";
    const result = applyProposedChanges(text, [
      finding({ quoted_text: "Deposit due 50%", language: "Deposit due 25%", location_section: "Section 9" }),
    ]);
    expect(result.applied).toHaveLength(1);
    expect(result.text).toBe("4. Deposit Terms\n\nDeposit due 50%\n\n9. Interim Terms\n\nDeposit due 25%");
  });

  /**
   * §1.5's section anchors read a clause number that opens the line, or a
   * heading carrying the extractor's hash marks. A contract writing "Section 9."
   * in prose gives neither, so the ambiguity stands and the change is listed
   * rather than applied. Refusing is the safe direction; recorded because the
   * anchor patterns live in §1.5 and widening them belongs there.
   */
  it("leaves an ambiguous row alone when the section is written in prose", () => {
    const text =
      "Section 4. Deposit Terms\n\nDeposit due 50%\n\nSection 9. Interim Terms\n\nDeposit due 50%";
    const result = applyProposedChanges(text, [
      finding({ quoted_text: "Deposit due 50%", language: "Deposit due 25%", location_section: "Section 9" }),
    ]);
    expect(result.applied).toHaveLength(0);
    expect(result.text).toBe(text);
  });

  it("renders a multi-page table contract cleanly and passes the gate", async () => {
    const lines = [0, 1, 2].flatMap((page) => [
      line("Days Prior | Damages", TOP, page),
      line(`${365 - page * 90} or more | ${25 + page * 10}%`, TOP - PITCH, page),
      line(`Continuation row b on page ${page} of the schedule.`, TOP - PITCH * 2, page),
      line(`Continuation row c on page ${page} of the schedule.`, TOP - PITCH * 3, page),
      line(`Page ${page + 1} of 3`, 40, page, 480),
    ]);
    const result = await generateCleanContractPdf({
      lines,
      findings: [finding({ quoted_text: "365 or more | 25%", language: "365 or more | 10%" })],
      title: "Proposed Amended Contract",
    });

    expect(result.conservation.problems).toEqual([]);
    expect(result.appliedCount).toBe(1);

    const text = (await extractPdfLines(result.pdfBytes.slice())).map((l) => l.text).join(" ");
    expect(text).toContain("365 or more | 10%");
    expect(text).toContain("275 or more | 35%");
    expect(text).toContain("185 or more | 45%");
    expect(text).not.toMatch(/Page \d of 3/);
  });

  it("renders curly quotes and dashes through to a clean PDF without losing content", async () => {
    const doc = [
      line("The “Group” shall pay seventy‑five percent (75%) — no exceptions.", TOP),
      line("Rooms 100–200 are held at $259.00.", TOP - PITCH),
    ];
    const result = await generateCleanContractPdf({
      lines: doc,
      findings: [finding({ quoted_text: 'seventy-five percent (75%)', language: "fifty percent (50%)" })],
      title: "Proposed Amended Contract",
    });

    expect(result.conservation.problems).toEqual([]);
    const text = (await extractPdfLines(result.pdfBytes.slice())).map((l) => l.text).join(" ");
    expect(text).toContain("fifty percent (50%)");
    expect(text).toContain("Rooms 100–200");
    expect(text).toContain("$259.00");
  });
});
