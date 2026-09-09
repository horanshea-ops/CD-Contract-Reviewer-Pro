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
    expect(out).toContain("Further Proposed Changes");
    expect(out).toContain("fifty percent (50%)");
    expect(out).toMatch(/wording above is unchanged/i);
    // Why an item could not be placed is the associate's business, not the property's.
    expect(out).not.toMatch(/could not be identified|automatically/i);
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
    expect(text).toContain("Further Proposed Changes");
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

/**
 * Harder situations: many changes in one contract, replacements that interact
 * with the text they replace, malformed findings, and characters the renderer
 * cannot draw.
 */
describe("complicated substitutions", () => {
  const contract = [
    line("1. Attrition. The threshold is ninety percent (90%) measured nightly.", TOP),
    line("2. Cancellation. Damages are seventy-five percent (75%) of revenue.", TOP - PITCH),
    line("3. Cutoff. Reservations close forty-five (45) days prior.", TOP - PITCH * 2),
    line("4. Deposit. A deposit of thirty percent (30%) is due at signing.", TOP - PITCH * 3),
    line("5. Service. A service charge of twenty-two percent (22%) applies.", TOP - PITCH * 4),
  ];

  it("applies five changes across one contract, each in the right clause", () => {
    const text = reconstructContractText(contract);
    const result = applyProposedChanges(text, [
      finding({ clause_type: "attrition", quoted_text: "ninety percent (90%)", language: "eighty percent (80%)" }),
      finding({ clause_type: "cancellation", quoted_text: "seventy-five percent (75%)", language: "fifty percent (50%)" }),
      finding({ clause_type: "cutoff_date", quoted_text: "forty-five (45) days", language: "twenty-one (21) days" }),
      finding({ clause_type: "damage_deposit", quoted_text: "thirty percent (30%)", language: "ten percent (10%)" }),
      finding({ clause_type: "gratuity_service_charge", quoted_text: "twenty-two percent (22%)", language: "twenty percent (20%)" }),
    ]);

    expect(result.applied).toHaveLength(5);
    expect(result.unplaced).toHaveLength(0);
    expect(result.text).toBe(
      "1. Attrition. The threshold is eighty percent (80%) measured nightly. " +
        "2. Cancellation. Damages are fifty percent (50%) of revenue. " +
        "3. Cutoff. Reservations close twenty-one (21) days prior. " +
        "4. Deposit. A deposit of ten percent (10%) is due at signing. " +
        "5. Service. A service charge of twenty percent (20%) applies."
    );
  });

  it("applies two changes whose spans touch end to start", () => {
    const result = applyProposedChanges("ABCDEF", [
      finding({ clause_type: "attrition", quoted_text: "ABC", language: "xxx" }),
      finding({ clause_type: "cancellation", quoted_text: "DEF", language: "yyy" }),
    ]);
    expect(result.applied).toHaveLength(2);
    expect(result.text).toBe("xxxyyy");
  });

  it("substitutes once when the replacement contains the text it replaces", () => {
    const result = applyProposedChanges("The fee is 50% of revenue.", [
      finding({ quoted_text: "50% of revenue", language: "50% of net revenue, less resold rooms" }),
    ]);
    expect(result.applied).toHaveLength(1);
    expect(result.text).toBe("The fee is 50% of net revenue, less resold rooms.");
  });

  it("treats an empty replacement as a deletion rather than skipping it", () => {
    const result = applyProposedChanges("Keep this. Delete this sentence. Keep that.", [
      finding({ quoted_text: "Delete this sentence. ", language: "" }),
    ]);
    expect(result.applied).toHaveLength(1);
    expect(result.text).toBe("Keep this. Keep that.");
  });

  it("lists a finding that quotes nothing but is not marked as a new clause", () => {
    const result = applyProposedChanges("Some contract text.", [
      finding({ quoted_text: null, language: "Replacement" }),
    ]);
    expect(result.applied).toHaveLength(0);
    expect(result.unplaced).toHaveLength(1);
    expect(result.unplaced[0].reason).toMatch(/quotes no wording/i);
    expect(result.text).toBe("Some contract text.");
  });

  it("applies the first of two findings quoting the same text and lists the second", () => {
    const result = applyProposedChanges("The fee is 50% of revenue.", [
      finding({ quoted_text: "50%", language: "25%" }),
      finding({ clause_type: "attrition", quoted_text: "50%", language: "30%" }),
    ]);
    expect(result.applied).toHaveLength(1);
    expect(result.unplaced).toHaveLength(1);
    expect(result.unplaced[0].reason).toMatch(/overlaps/i);
    expect(result.text).toBe("The fee is 25% of revenue.");
  });

  it("refuses a value that is a prefix of other values in the same contract", () => {
    const text = reconstructContractText([
      line("Rate V1 applies to the block.", TOP),
      line("Rate V10 applies to suites.", TOP - PITCH),
      line("Rate V11 applies to staff rooms.", TOP - PITCH * 2),
    ]);
    const result = applyProposedChanges(text, [finding({ quoted_text: "V1", language: "V2" })]);
    expect(result.applied).toHaveLength(0);
    expect(result.unplaced[0].reason).toMatch(/appears 3 times/i);
  });

  it("handles a dollar amount in the replacement without treating it as a pattern", () => {
    const result = applyProposedChanges("The minimum is $45,000 for the Event.", [
      finding({ clause_type: "fb_minimum", quoted_text: "$45,000", language: "$30,000 (or $25,000 if rooms fall short)" }),
    ]);
    expect(result.text).toBe("The minimum is $30,000 (or $25,000 if rooms fall short) for the Event.");
  });

  it("puts pages back in order when they arrive reversed", () => {
    const text = reconstructContractText([
      line("Page two content here.", TOP, 1),
      line("Page one content here.", TOP, 0),
    ]);
    expect(text).toBe("Page one content here.\n\nPage two content here.");
  });

  it("returns the contract unchanged when nothing was accepted", async () => {
    const result = await generateCleanContractPdf({
      lines: contract,
      findings: [],
      title: "Proposed Amended Contract",
    });
    expect(result.appliedCount).toBe(0);
    expect(result.additions).toHaveLength(0);
    expect(result.unplaced).toHaveLength(0);
    expect(result.conservation.problems).toEqual([]);

    const text = (await extractPdfLines(result.pdfBytes.slice())).map((l) => l.text).join(" ");
    expect(text).toContain("ninety percent (90%)");
    expect(text).toContain("twenty-two percent (22%)");
  });

  it("reports characters the PDF font cannot draw instead of dropping them quietly", async () => {
    const result = await generateCleanContractPdf({
      lines: [line("The α-block is held at the group rate.", TOP)],
      findings: [],
      title: "Proposed Amended Contract",
    });
    expect(result.conservation.ok).toBe(false);
    expect(result.conservation.problems.join(" ")).toMatch(/cannot render/i);
  });

  it("accepts currency and fraction symbols the font can draw", async () => {
    const result = await generateCleanContractPdf({
      lines: [line("Rate €259 or £220, ½ day at 20° ambient — per night.", TOP)],
      findings: [],
      title: "Proposed Amended Contract",
    });
    expect(result.conservation.problems).toEqual([]);
  });

  it("renders a long replacement clause across a page boundary with the gate clean", async () => {
    const long = Array.from({ length: 8 }, (_, i) => `Sub-clause ${i + 1} of the replacement text, stating an obligation in full.`).join(" ");
    const result = await generateCleanContractPdf({
      lines: contract,
      findings: [finding({ clause_type: "attrition", quoted_text: "ninety percent (90%) measured nightly", language: long })],
      title: "Proposed Amended Contract",
    });

    expect(result.conservation.problems).toEqual([]);
    expect(result.appliedCount).toBe(1);

    const text = (await extractPdfLines(result.pdfBytes.slice())).map((l) => l.text).join(" ");
    expect(text).toContain("Sub-clause 1 of the replacement text");
    expect(text).toContain("Sub-clause 8 of the replacement text");
    expect(text).not.toContain("ninety percent (90%)");
  });

  it("carries a full run of changes, an addition and an unplaced item through one render", async () => {
    const result = await generateCleanContractPdf({
      lines: contract,
      findings: [
        finding({ clause_type: "attrition", quoted_text: "ninety percent (90%)", language: "eighty percent (80%)" }),
        finding({ clause_type: "cancellation", quoted_text: "seventy-five percent (75%)", language: "fifty percent (50%)" }),
        finding({ clause_type: "walk_relocation", is_missing_clause: true, quoted_text: null, language: "Hotel shall provide comparable lodging at its expense." }),
        finding({ clause_type: "rebates", quoted_text: "a rebate clause that is not in this contract", language: "One complimentary room per forty rooms." }),
      ],
      title: "Proposed Amended Contract",
    });

    expect(result.appliedCount).toBe(2);
    expect(result.additions).toHaveLength(1);
    expect(result.unplaced).toHaveLength(1);
    expect(result.conservation.problems).toEqual([]);

    const text = (await extractPdfLines(result.pdfBytes.slice())).map((l) => l.text).join(" ");
    expect(text).toContain("eighty percent (80%)");
    expect(text).toContain("fifty percent (50%)");
    expect(text).toContain("Hotel shall provide comparable lodging");
    expect(text).toContain("One complimentary room per forty rooms.");
    expect(text).toContain("Cutoff. Reservations close forty-five (45) days prior.");
  });
});

/**
 * Scale, ordering and the seams between reconstruction and rendering.
 */
describe("long contracts and boundary conditions", () => {
  function row(cells: { text: string; x: number }[], y: number, page = 0): RenderedLine[] {
    return cells.map((c) => line(c.text, y, page, c.x));
  }

  /** Seven source pages of dense text, which flows to more rendered pages than it came from. */
  const bigContract = Array.from({ length: 300 }, (_, i) =>
    line(
      `Clause ${i}. Obligation number ${i} is stated here in full sentence form.`,
      TOP - (i % 45) * PITCH,
      Math.floor(i / 45)
    )
  );

  it("renders a long contract without losing any of it", async () => {
    const result = await generateCleanContractPdf({
      lines: bigContract,
      findings: [finding({ quoted_text: "Obligation number 150", language: "Obligation number one hundred and fifty" })],
      title: "Proposed Amended Contract",
    });

    expect(result.conservation.problems).toEqual([]);
    expect(result.appliedCount).toBe(1);

    const text = (await extractPdfLines(result.pdfBytes.slice())).map((l) => l.text).join(" ");
    expect(text).toContain("Clause 0.");
    expect(text).toContain("Clause 299.");
    expect(text).toContain("Obligation number one hundred and fifty");
  });

  /**
   * A paragraph taller than a page used to be drawn past the bottom margin at
   * negative coordinates, off the canvas, and silently lost.
   */
  it("flows a single paragraph longer than one page across pages", async () => {
    const { textToPdf } = await import("@/lib/text-to-pdf");
    const sentences = Array.from({ length: 200 }, (_, i) => `Sentence ${i} of one very long paragraph.`);
    const body = sentences.join(" ");
    const { pdfBytes } = await textToPdf("Proposed Amended Contract", body);

    const text = (await extractPdfLines(pdfBytes.slice())).map((l) => l.text).join(" ");
    expect(text).toContain("Sentence 0 of one very long paragraph.");
    expect(text).toContain("Sentence 199 of one very long paragraph.");
  });

  it("gives the same result whatever order the findings arrive in", () => {
    const text = reconstructContractText([
      line("1. Attrition is 90% nightly.", TOP),
      line("2. Damages are 75% of revenue.", TOP - PITCH),
      line("3. Cutoff is 45 days prior.", TOP - PITCH * 2),
      line("4. Deposit is 30% at signing.", TOP - PITCH * 3),
    ]);
    const fs = [
      finding({ clause_type: "attrition", quoted_text: "90%", language: "80%" }),
      finding({ quoted_text: "75%", language: "50%" }),
      finding({ clause_type: "cutoff_date", quoted_text: "45 days", language: "21 days" }),
      finding({ clause_type: "damage_deposit", quoted_text: "30%", language: "10%" }),
    ];

    const forward = applyProposedChanges(text, fs).text;
    const reversed = applyProposedChanges(text, [...fs].reverse()).text;
    const shuffled = applyProposedChanges(text, [fs[2], fs[0], fs[3], fs[1]]).text;

    expect(reversed).toBe(forward);
    expect(shuffled).toBe(forward);
    expect(forward).toContain("80%");
    expect(forward).toContain("21 days");
  });

  it("produces identical text on repeated runs", () => {
    const first = reconstructContractText(bigContract);
    const second = reconstructContractText(bigContract);
    expect(second).toBe(first);
  });

  it("matches a quote whose halves sat either side of a removed footer", () => {
    const lines = [0, 1, 2].flatMap((page) => [
      line(`Line one of body text on page ${page}.`, TOP, page),
      line(`Line two of body text on page ${page}.`, TOP - PITCH, page),
      line(`Line three of body text on page ${page}.`, TOP - PITCH * 2, page),
      line(page === 0 ? "The Group shall be liable" : `Continuing text on page ${page}.`, TOP - PITCH * 3, page),
      line(`Page ${page + 1} of 3`, 40, page, 480),
    ]);
    const text = reconstructContractText(lines);
    expect(text).not.toMatch(/Page \d of 3/);
    expect(text).toContain("The Group shall be liable");
  });

  it("cannot place a quote that named text removed as page furniture", () => {
    const lines = [0, 1, 2].flatMap((page) => [
      line(`Clause ${page * 2 + 1}. An obligation is stated here.`, TOP, page),
      line(`Clause ${page * 2 + 2}. Another obligation follows.`, TOP - PITCH, page),
      line("Payment is due on receipt.", TOP - PITCH * 2, page),
      line("Notice shall be in writing.", TOP - PITCH * 3, page),
      line(`Page ${page + 1} of 3`, 40, page, 480),
    ]);
    const result = applyProposedChanges(reconstructContractText(lines), [
      finding({ quoted_text: "Page 2 of 3", language: "Page two" }),
    ]);
    expect(result.applied).toHaveLength(0);
    expect(result.unplaced).toHaveLength(1);
  });

  it("keeps a table cell that wraps onto a second line with its row", () => {
    const text = reconstructContractText([
      ...row([{ text: "Cancellation", x: 56 }, { text: "Damages are calculated as a", x: 200 }], TOP),
      line("percentage of room revenue.", TOP - PITCH, 0, 200),
      ...row([{ text: "Attrition", x: 56 }, { text: "Measured cumulatively.", x: 200 }], TOP - PITCH * 2),
    ]);
    expect(text).toBe(
      "Cancellation Damages are calculated as a percentage of room revenue. Attrition Measured cumulatively."
    );
  });

  it("treats cells nudged off each other's baseline as one row", () => {
    expect(reconstructContractText([line("Left", TOP, 0, 56), line("Right", TOP - 3, 0, 300)])).toBe("Left Right");
  });

  it("reads a table followed immediately by prose", () => {
    const text = reconstructContractText([
      ...row([{ text: "365 or more", x: 56 }, { text: "25%", x: 300 }], TOP),
      ...row([{ text: "180 to 364", x: 56 }, { text: "50%", x: 300 }], TOP - PITCH),
      line("The schedule above governs all cancellations.", TOP - PITCH * 2 - 20),
    ]);
    expect(text).toBe(
      "365 or more 25% 180 to 364 50%\n\nThe schedule above governs all cancellations."
    );
  });

  it("renders a contract that is nothing but a table", async () => {
    const table = [
      ...row([{ text: "Item", x: 56 }, { text: "Amount", x: 300 }], TOP),
      ...row([{ text: "Deposit", x: 56 }, { text: "30%", x: 300 }], TOP - PITCH),
      ...row([{ text: "Attrition", x: 56 }, { text: "90%", x: 300 }], TOP - PITCH * 2),
    ];
    const result = await generateCleanContractPdf({
      lines: table,
      findings: [finding({ clause_type: "attrition", quoted_text: "Attrition 90%", language: "Attrition 80%" })],
      title: "Proposed Amended Contract",
    });

    expect(result.conservation.problems).toEqual([]);
    const text = (await extractPdfLines(result.pdfBytes.slice())).map((l) => l.text).join(" ");
    expect(text).toContain("Attrition 80%");
    expect(text).toContain("Deposit 30%");
  });

  it("stays clean when a new clause repeats wording already in the body", async () => {
    const doc = [line("Notice shall be given in writing to the Hotel.", TOP)];
    const result = await generateCleanContractPdf({
      lines: doc,
      findings: [
        finding({
          clause_type: "walk_relocation",
          is_missing_clause: true,
          quoted_text: null,
          language: "Notice shall be given in writing to the Hotel.",
        }),
      ],
      title: "Proposed Amended Contract",
    });
    expect(result.conservation.problems).toEqual([]);
    expect(result.additions).toHaveLength(1);
  });

  it("stays clean when an unplaced change repeats wording already in the body", async () => {
    const doc = [line("Notice shall be given in writing to the Hotel.", TOP)];
    const result = await generateCleanContractPdf({
      lines: doc,
      findings: [
        finding({ quoted_text: "wording that appears nowhere", language: "Notice shall be given in writing to the Hotel." }),
      ],
      title: "Proposed Amended Contract",
    });
    expect(result.conservation.problems).toEqual([]);
    expect(result.unplaced).toHaveLength(1);
  });

  it("handles a page holding a single line", () => {
    const text = reconstructContractText([
      line("Only line on the first page.", TOP, 0),
      line("First line on the second page.", TOP, 1),
      line("Second line on the second page.", TOP - PITCH, 1),
    ]);
    expect(text).toBe(
      "Only line on the first page.\n\nFirst line on the second page. Second line on the second page."
    );
  });

  it("keeps a ragged table whose columns shift between rows", () => {
    const text = reconstructContractText([
      ...row([{ text: "Deposit", x: 56 }, { text: "30%", x: 300 }], TOP),
      ...row([{ text: "Attrition", x: 60 }, { text: "90%", x: 312 }], TOP - PITCH),
      ...row([{ text: "Cancellation", x: 52 }, { text: "75%", x: 296 }], TOP - PITCH * 2),
    ]);
    expect(text).toBe("Deposit 30% Attrition 90% Cancellation 75%");
  });
});

/**
 * The last of the awkward inputs: tokens the renderer cannot wrap, quotes that
 * cover everything or overlap each other, and matching at scale.
 */
describe("degenerate inputs", () => {
  it("breaks a token too wide to fit rather than drawing it off the page", async () => {
    const token = "X".repeat(400);
    const result = await generateCleanContractPdf({
      lines: [line(`Reference ${token} ends here.`, TOP)],
      findings: [],
      title: "Proposed Amended Contract",
    });

    expect(result.conservation.problems).toEqual([]);
    const text = (await extractPdfLines(result.pdfBytes.slice())).map((l) => l.text).join("");
    expect(text.replace(/\s/g, "")).toContain(token);
    expect(text).toContain("ends here.");
  });

  it("renders a long unbroken reference number without losing digits", async () => {
    const account = "4".repeat(180);
    const result = await generateCleanContractPdf({
      lines: [line(`Account ${account} is the billing reference.`, TOP)],
      findings: [],
      title: "Proposed Amended Contract",
    });
    expect(result.conservation.problems).toEqual([]);
  });

  it("replaces the whole document when the quote covers all of it", () => {
    const text = reconstructContractText([line("The whole contract in one line.", TOP)]);
    const result = applyProposedChanges(text, [finding({ quoted_text: text, language: "Entirely replaced." })]);
    expect(result.applied).toHaveLength(1);
    expect(result.text).toBe("Entirely replaced.");
  });

  it("matches across a carriage return inside a line's text", () => {
    const text = reconstructContractText([line("First part.\r\nSecond part.", TOP)]);
    const result = applyProposedChanges(text, [
      finding({ quoted_text: "First part. Second part.", language: "Replaced." }),
    ]);
    expect(result.applied).toHaveLength(1);
  });

  it("applies only the first of three overlapping findings and lists the rest", () => {
    const result = applyProposedChanges("The fee is 50% of gross revenue.", [
      finding({ quoted_text: "50% of gross revenue", language: "A" }),
      finding({ clause_type: "attrition", quoted_text: "of gross", language: "B" }),
      finding({ clause_type: "rebates", quoted_text: "gross revenue", language: "C" }),
    ]);
    expect(result.applied).toHaveLength(1);
    expect(result.unplaced).toHaveLength(2);
    expect(result.text).toBe("The fee is A.");
  });

  it("refuses a quote matching two identical sentences in a row", () => {
    const text = reconstructContractText([
      line("Notice is required.", TOP),
      line("Notice is required.", TOP - PITCH),
    ]);
    const result = applyProposedChanges(text, [
      finding({ quoted_text: "Notice is required.", language: "Notice is waived." }),
    ]);
    expect(result.applied).toHaveLength(0);
    expect(result.unplaced).toHaveLength(1);
    expect(result.text).toBe("Notice is required. Notice is required.");
  });

  it("locates an exact quote in a contract of three hundred clauses", () => {
    const big = Array.from({ length: 300 }, (_, i) =>
      line(`Clause ${i}. Obligation number ${i} is stated here in full sentence form.`, TOP - (i % 45) * PITCH, Math.floor(i / 45))
    );
    const result = applyProposedChanges(reconstructContractText(big), [
      finding({ quoted_text: "Clause 150. Obligation number 150 is stated here in full sentence form.", language: "Clause 150. Replaced." }),
    ]);
    expect(result.applied).toHaveLength(1);
    expect(result.text).toContain("Clause 150. Replaced.");
    expect(result.text).toContain("Clause 149.");
    expect(result.text).toContain("Clause 151.");
  });

  it("matches a quote the model reworded slightly", () => {
    const text = reconstructContractText([
      line("Attrition. The threshold is ninety percent measured cumulatively across the block.", TOP),
      line("Cancellation. Damages are seventy-five percent of anticipated room revenue.", TOP - PITCH),
    ]);
    const result = applyProposedChanges(text, [
      finding({ clause_type: "attrition", quoted_text: "Attrition. The threshold is ninety per cent measured cumulatively across the block.", language: "Attrition. The threshold is eighty percent." }),
    ]);
    expect(result.applied).toHaveLength(1);
    expect(result.text).toContain("eighty percent");
  });

  /**
   * Matching declines rather than guessing when a reworded quote sits in a
   * contract of near-identical clauses. Listing the change is the safe
   * direction, and the thresholds behind it belong to §1.5.
   */
  it("lists a reworded quote it cannot separate from near-identical neighbours", () => {
    const big = Array.from({ length: 300 }, (_, i) =>
      line(`Clause ${i}. Obligation number ${i} is stated here in full sentence form.`, TOP - (i % 45) * PITCH, Math.floor(i / 45))
    );
    const result = applyProposedChanges(reconstructContractText(big), [
      finding({ quoted_text: "Clause 150. Obligation numbered 150 is stated here in full sentence form.", language: "Replaced." }),
    ]);
    expect(result.applied).toHaveLength(0);
    expect(result.unplaced).toHaveLength(1);
  });

  it("renders twelve new clauses without tripping the gate", async () => {
    const additions = Array.from({ length: 12 }, (_, i) =>
      finding({ clause_type: `clause_${i}`, is_missing_clause: true, quoted_text: null, language: `New clause ${i} stating an obligation in full.` })
    );
    const result = await generateCleanContractPdf({
      lines: [line("Body text of the agreement.", TOP)],
      findings: additions,
      title: "Proposed Amended Contract",
    });

    expect(result.additions).toHaveLength(12);
    expect(result.conservation.problems).toEqual([]);

    const text = (await extractPdfLines(result.pdfBytes.slice())).map((l) => l.text).join(" ");
    expect(text).toContain("New clause 0 stating an obligation in full.");
    expect(text).toContain("New clause 11 stating an obligation in full.");
  });

  it("renders twelve unplaced changes without tripping the gate", async () => {
    const unplaceable = Array.from({ length: 12 }, (_, i) =>
      finding({ clause_type: `clause_${i}`, quoted_text: `wording ${i} that is nowhere in this contract`, language: `Proposed wording ${i}.` })
    );
    const result = await generateCleanContractPdf({
      lines: [line("Body text of the agreement.", TOP)],
      findings: unplaceable,
      title: "Proposed Amended Contract",
    });

    expect(result.unplaced).toHaveLength(12);
    expect(result.conservation.problems).toEqual([]);

    const text = (await extractPdfLines(result.pdfBytes.slice())).map((l) => l.text).join(" ");
    expect(text).toContain("Proposed wording 0.");
    expect(text).toContain("Proposed wording 11.");
    expect(text).toContain("Body text of the agreement.");
  });

  it("handles a document whose every line shares one baseline", () => {
    const text = reconstructContractText([
      line("First fragment.", TOP, 0, 56),
      line("Second fragment.", TOP, 0, 200),
      line("Third fragment.", TOP, 0, 360),
    ]);
    expect(text).toBe("First fragment. Second fragment. Third fragment.");
  });

  it("returns nothing for a document of only blank lines", () => {
    expect(reconstructContractText([line("   ", TOP), line("", TOP - PITCH)])).toBe("");
  });
});

/**
 * Findings whose proposed language is commentary rather than clause text.
 * Found against the real ConferenceDirect standard contract, where accepting
 * one such finding replaced a live rate-parity clause with the sentence
 * "No change needed — retain as drafted."
 */
describe("proposed language that is not a replacement clause", () => {
  const body = "Hotel guarantees not to sell guestrooms at a lower rate than the Group rate.";

  it("keeps the original wording when the language says no change is needed", () => {
    const result = applyProposedChanges(body, [
      finding({ clause_type: "rate_parity", quoted_text: body, language: "No change needed — retain as drafted." }),
    ]);
    expect(result.applied).toHaveLength(0);
    expect(result.unplaced).toHaveLength(1);
    expect(result.unplaced[0].reason).toMatch(/no change is needed/i);
    expect(result.text).toBe(body);
  });

  it.each([
    "No change recommended; clause matches CD standard as written.",
    "No changes required.",
    "No revision needed.",
    "None needed.",
    "Not applicable.",
    "N/A",
    "Retain as drafted.",
    "Acceptable as written.",
  ])("treats %j as commentary rather than clause text", (language) => {
    const result = applyProposedChanges(body, [finding({ quoted_text: body, language })]);
    expect(result.applied).toHaveLength(0);
    expect(result.text).toBe(body);
  });

  it("still applies clause text that merely mentions the word change", () => {
    const result = applyProposedChanges(body, [
      finding({ quoted_text: body, language: "Any change to the Group rate requires written consent of both parties." }),
    ]);
    expect(result.applied).toHaveLength(1);
    expect(result.text).toContain("requires written consent");
  });

  it("still applies a clause beginning with the word no", () => {
    const result = applyProposedChanges(body, [
      finding({ quoted_text: body, language: "No guestroom shall be sold below the Group rate during the Event." }),
    ]);
    expect(result.applied).toHaveLength(1);
    expect(result.text).toContain("No guestroom shall be sold");
  });

  it("lists the commentary in the closing section so the associate still sees it", () => {
    const result = applyProposedChanges(body, [
      finding({ clause_type: "rate_parity", quoted_text: body, language: "No change needed — retain as drafted." }),
    ]);
    const text = buildCleanContractText(result);
    expect(text).toContain("Further Proposed Changes");
    expect(text).toContain("Rate parity");
    expect(text).toContain(body);
  });
});
