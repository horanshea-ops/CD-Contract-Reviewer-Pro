import { describe, expect, it } from "vitest";
import { validateRedline } from "@/lib/redline-validation";
import type { CheckName, RedlineEngineResult, UnappliedFinding, ValidationReport } from "@/lib/redline-validation";
import {
  CONTENT_TYPES,
  DOC_RELS,
  ROOT_RELS,
  buildDocx,
  del,
  delRun,
  documentXml,
  headerXml,
  ins,
  insertedPara,
  para,
  run,
  table,
  zipParts,
} from "./helpers/docx-package";

/**
 * The oracle's own test suite (MASTER_PLAN.md §1.6).
 *
 * Every check gets a document built to violate it. A validation layer that
 * passes everything is worse than none at all, because it reads as assurance —
 * so the negative case is the test that matters and the clean case is the
 * control.
 */

const OUR = "Jane Associate";
const THEM = "Dana Reyes";

const CLAUSE = "Group shall be liable for eighty percent (80%) of the group rate.";

/** The same edit every clean case applies: 80% struck, 70% inserted. */
const OUR_EDIT =
  run("Group shall be liable for ") +
  del(9000, OUR, delRun("eighty percent (80%)")) +
  ins(9001, OUR, run("seventy percent (70%)")) +
  run(" of the group rate.");

function engine(docxBytes: Uint8Array, over: Partial<RedlineEngineResult> = {}): RedlineEngineResult {
  return {
    docxBytes,
    appliedCount: 1,
    unapplied: [],
    ownRevisionIds: ["9000", "9001"],
    ...over,
  };
}

async function validate(
  originalBytes: Uint8Array,
  outputBytes: Uint8Array,
  over: Partial<RedlineEngineResult> = {},
  author = OUR
) {
  return validateRedline({ originalBytes, engineResult: engine(outputBytes, over), author });
}

const checkFor = (report: ValidationReport, name: CheckName) => report.checks.find((c) => c.name === name);

// ---------------------------------------------------------------------------
// Control: a correct redline passes everything.
// ---------------------------------------------------------------------------

describe("a correctly marked-up document", () => {
  it("is clean, and every check ran", async () => {
    const report = await validate(await buildDocx(para(run(CLAUSE))), await buildDocx(para(OUR_EDIT)));

    expect(report.checks.filter((c) => !c.passed)).toEqual([]);
    expect(report.outcome).toBe("clean");
    expect(report.fallbackReason).toBeNull();
    expect(report.checks.map((c) => c.name)).toEqual([
      "archive_readable",
      "parts_parse",
      "parts_preserved",
      "content_types_consistent",
      "relationships_resolve",
      "revision_ids_unique",
      "revision_marks_wellformed",
      "table_structure_preserved",
      "paragraph_count_preserved",
      "reject_round_trip",
    ]);
  });

  it("is partial, not clean, when the engine could not apply everything", async () => {
    const unapplied: UnappliedFinding[] = [
      { clause_type: "force_majeure", severity: "high", quoted_text: "beyond its control", reason: "crosses_boundary" },
    ];
    const report = await validate(
      await buildDocx(para(run(CLAUSE))),
      await buildDocx(para(OUR_EDIT)),
      { unapplied }
    );

    expect(report.outcome).toBe("partial");
    expect(report.fallbackReason).toBeNull();
    expect(report.unapplied).toEqual(unapplied);
  });
});

// ---------------------------------------------------------------------------
// §1.6.1 — structural validation.
// ---------------------------------------------------------------------------

describe("§1.6.1 structural checks", () => {
  it("fails when a part is not well-formed XML", async () => {
    // The Stage 0 corruption: a splice across </w:ins> leaves a tag mismatch,
    // and Word refuses to open the file.
    const broken = `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:ins w:id="1" w:author="x" w:date="d"></w:p></w:body></w:document>`;
    const output = await zipParts({
      "[Content_Types].xml": CONTENT_TYPES,
      "_rels/.rels": ROOT_RELS,
      "word/document.xml": broken,
      "word/_rels/document.xml.rels": DOC_RELS,
    });

    const report = await validate(await buildDocx(para(run(CLAUSE))), output);
    expect(checkFor(report, "parts_parse")?.passed).toBe(false);
    expect(report.outcome).toBe("fallback");
    expect(report.fallbackReason).toMatch(/Word would refuse to open/);
  });

  it("fails when a part of the original is missing from the output", async () => {
    const original = await buildDocx(para(run(CLAUSE)), { "word/header1.xml": headerXml(para(run("Cutoff: 30 days"))) });
    const output = await buildDocx(para(OUR_EDIT));

    const report = await validate(original, output);
    expect(checkFor(report, "parts_preserved")?.passed).toBe(false);
    expect(report.outcome).toBe("fallback");
  });

  it("fails when a part is not declared in [Content_Types].xml", async () => {
    const output = await zipParts({
      "[Content_Types].xml": CONTENT_TYPES, // no Default for png
      "_rels/.rels": ROOT_RELS,
      "word/document.xml": documentXml(para(OUR_EDIT)),
      "word/_rels/document.xml.rels": DOC_RELS,
      "word/media/logo.png": "not-really-a-png",
    });

    const report = await validate(await buildDocx(para(run(CLAUSE))), output);
    expect(checkFor(report, "content_types_consistent")?.passed).toBe(false);
    expect(checkFor(report, "content_types_consistent")?.detail).toMatch(/logo\.png/);
  });

  it("fails when [Content_Types].xml declares a part that is not in the file", async () => {
    const output = await zipParts({
      "[Content_Types].xml": CONTENT_TYPES.replace(
        "</Types>",
        `<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/></Types>`
      ),
      "_rels/.rels": ROOT_RELS,
      "word/document.xml": documentXml(para(OUR_EDIT)),
      "word/_rels/document.xml.rels": DOC_RELS,
    });

    const report = await validate(await buildDocx(para(run(CLAUSE))), output);
    expect(checkFor(report, "content_types_consistent")?.passed).toBe(false);
    expect(checkFor(report, "content_types_consistent")?.detail).toMatch(/header1\.xml/);
  });

  it("fails when a relationship points at a part that is not there", async () => {
    const dangling = DOC_RELS.replace(
      "/>",
      `><Relationship Id="rId5" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/></Relationships>`
    ).replace("</Relationships></Relationships>", "</Relationships>");
    const output = await zipParts({
      "[Content_Types].xml": CONTENT_TYPES,
      "_rels/.rels": ROOT_RELS,
      "word/document.xml": documentXml(para(OUR_EDIT)),
      "word/_rels/document.xml.rels": dangling,
    });

    const report = await validate(await buildDocx(para(run(CLAUSE))), output);
    expect(checkFor(report, "relationships_resolve")?.passed).toBe(false);
    expect(checkFor(report, "relationships_resolve")?.detail).toMatch(/header1\.xml/);
  });

  it("fails when two tracked changes share an id", async () => {
    const body =
      run("Group shall be liable for ") +
      del(9000, OUR, delRun("eighty percent (80%)")) +
      ins(9000, OUR, run("seventy percent (70%)")) +
      run(" of the group rate.");

    const report = await validate(await buildDocx(para(run(CLAUSE))), await buildDocx(para(body)), {
      ownRevisionIds: ["9000"],
    });
    expect(checkFor(report, "revision_ids_unique")?.passed).toBe(false);
    expect(report.outcome).toBe("fallback");
  });

  it("fails when a revision id is past what Word can store", async () => {
    const body =
      run("Group shall be liable for ") +
      del(2147483648, OUR, delRun("eighty percent (80%)")) +
      ins(2147483649, OUR, run("seventy percent (70%)")) +
      run(" of the group rate.");

    const report = await validate(await buildDocx(para(run(CLAUSE))), await buildDocx(para(body)), {
      ownRevisionIds: ["2147483648", "2147483649"],
    });
    expect(checkFor(report, "revision_ids_unique")?.passed).toBe(false);
  });

  it("fails when deleted text is stored as normal text", async () => {
    // A w:del holding w:t rather than w:delText reappears when the change is
    // rejected, so the property gets wording nobody agreed to.
    const body =
      run("Group shall be liable for ") +
      del(9000, OUR, run("eighty percent (80%)")) +
      ins(9001, OUR, run("seventy percent (70%)")) +
      run(" of the group rate.");

    const report = await validate(await buildDocx(para(run(CLAUSE))), await buildDocx(para(body)));
    expect(checkFor(report, "revision_marks_wellformed")?.passed).toBe(false);
  });

  it("allows a deletion nested inside the property's own insertion", async () => {
    // §1.5.7's case. Attribution is by the nearest wrapper, so the delText
    // inside our w:del is correct even though a w:ins encloses it.
    const original = await buildDocx(para(run("Damages are ") + ins(500, THEM, run("fifty percent (50%)"))));
    const output = await buildDocx(
      para(
        run("Damages are ") +
          ins(500, THEM, del(9000, OUR, delRun("fifty percent (50%)"))) +
          ins(9001, OUR, run("twenty percent (20%)"))
      )
    );

    const report = await validate(original, output);
    expect(checkFor(report, "revision_marks_wellformed")?.passed).toBe(true);
    expect(checkFor(report, "reject_round_trip")?.passed).toBe(true);
    expect(report.outcome).toBe("clean");
  });

  it("fails when a table row loses a cell", async () => {
    // Stage 0's merged-cell bug. Totals stayed plausible, so the shape is
    // compared row by row.
    const rows = [
      ["Days", "Damages"],
      ["180 to 91", "fifty percent (50%)"],
    ];
    const original = await buildDocx(table(rows));
    const shortened = table(rows).replace(
      `<w:tc><w:tcPr><w:tcW w:w="2000" w:type="dxa"/></w:tcPr>${para(run("fifty percent (50%)"))}</w:tc>`,
      ""
    );
    const output = await buildDocx(shortened);

    const report = await validate(original, output, { appliedCount: 0 });
    expect(checkFor(report, "table_structure_preserved")?.passed).toBe(false);
    expect(checkFor(report, "table_structure_preserved")?.detail).toMatch(/row 2 had 2 cell\(s\) and now has 1/);
  });
});

// ---------------------------------------------------------------------------
// §1.6.2 — the reject round trip.
// ---------------------------------------------------------------------------

describe("§1.6.2 reject round trip", () => {
  it("fails when text is deleted without being marked as deleted", async () => {
    const original = await buildDocx(para(run(CLAUSE)) + para(run("Deposits are due on signing.")));
    const output = await buildDocx(para(OUR_EDIT));

    const report = await validate(original, output);
    expect(checkFor(report, "reject_round_trip")?.passed).toBe(false);
    expect(report.outcome).toBe("fallback");
  });

  it("fails when text is inserted without being marked as inserted", async () => {
    const original = await buildDocx(para(run(CLAUSE)));
    const output = await buildDocx(
      para(
        run("Group shall be liable for ") +
          del(9000, OUR, delRun("eighty percent (80%)")) +
          ins(9001, OUR, run("seventy percent (70%)")) +
          run(" of the group rate, plus a resort fee.")
      )
    );

    const report = await validate(original, output);
    expect(checkFor(report, "reject_round_trip")?.passed).toBe(false);
    expect(checkFor(report, "reject_round_trip")?.detail).toMatch(/does not restore the original wording/);
  });

  it("fails when an added paragraph would survive a reject-all", async () => {
    // Stage 0 defect 3. The runs are marked as inserted but the paragraph mark
    // is not, so rejecting empties the paragraph and leaves it behind. There is
    // no text difference to see, which is why the paragraph count is checked.
    const original = await buildDocx(para(run(CLAUSE)));
    const output = await buildDocx(
      para(OUR_EDIT) + para(ins(9002, OUR, run("REQUESTED ADDITION: resale credit language.")))
    );

    const report = await validate(original, output, { ownRevisionIds: ["9000", "9001", "9002"] });
    expect(checkFor(report, "reject_round_trip")?.passed).toBe(true);
    expect(checkFor(report, "paragraph_count_preserved")?.passed).toBe(false);
    expect(report.outcome).toBe("fallback");
  });

  it("accepts an added paragraph whose paragraph mark is marked as inserted", async () => {
    const original = await buildDocx(para(run(CLAUSE)));
    const output = await buildDocx(
      para(OUR_EDIT) +
        insertedPara(9003, OUR, ins(9002, OUR, run("REQUESTED ADDITION: resale credit language.")))
    );

    const report = await validate(original, output, {
      ownRevisionIds: ["9000", "9001", "9002", "9003"],
    });
    expect(report.checks.filter((c) => !c.passed)).toEqual([]);
    expect(report.outcome).toBe("clean");
  });

  it("does not unwind the property's own tracked changes", async () => {
    // The correction the plan text needs. Rejecting every revision, rather than
    // only ours, winds the contract back past what the property sent — which is
    // wrong on every negotiation round after the first.
    const theirs =
      run("Cancellation damages are ") +
      ins(500, THEM, run("fifty percent (50%)")) +
      del(501, THEM, delRun("ninety percent (90%)")) +
      run(" of revenue.");
    const original = await buildDocx(para(theirs) + para(run("The cutoff date is thirty (30) days prior to arrival.")));
    const output = await buildDocx(
      para(theirs) +
        para(
          run("The cutoff date is ") +
            del(9000, OUR, delRun("thirty (30)")) +
            ins(9001, OUR, run("forty-five (45)")) +
            run(" days prior to arrival.")
        )
    );

    const report = await validate(original, output);
    expect(checkFor(report, "reject_round_trip")?.passed).toBe(true);
    expect(report.outcome).toBe("clean");
  });

  it("fails when the output restores text the property had deleted", async () => {
    const theirs = run("Damages are ") + del(501, THEM, delRun("ninety percent (90%)")) + run(" of revenue.");
    const original = await buildDocx(para(theirs));
    const output = await buildDocx(para(run("Damages are ") + run("ninety percent (90%)") + run(" of revenue.")));

    const report = await validate(original, output, { appliedCount: 0, ownRevisionIds: [] });
    expect(checkFor(report, "reject_round_trip")?.passed).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Attribution — by id, with the author name as a fallback that says when it
// cannot be trusted.
// ---------------------------------------------------------------------------

describe("attribution", () => {
  it("falls back to the author name when the engine reports no ids", async () => {
    const report = await validate(await buildDocx(para(run(CLAUSE))), await buildDocx(para(OUR_EDIT)), {
      ownRevisionIds: [],
    });
    expect(checkFor(report, "reject_round_trip")?.passed).toBe(true);
    expect(report.outcome).toBe("clean");
  });

  it("refuses to certify when the document already has changes by the same author", async () => {
    // Without ids there is no way to tell our revision from one that arrived
    // with the document, so the honest answer is that it cannot be verified.
    const original = await buildDocx(para(run("Damages are ") + ins(700, OUR, run("fifty percent (50%)"))));
    const output = await buildDocx(
      para(run("Damages are ") + ins(700, OUR, run("fifty percent (50%)")) + ins(9001, OUR, run(" of revenue")))
    );

    const report = await validate(original, output, { ownRevisionIds: [] });
    expect(checkFor(report, "reject_round_trip")?.passed).toBe(false);
    expect(report.fallbackReason).toMatch(/cannot be told apart/);
  });

  it("certifies the same document when the engine reports its ids", async () => {
    const original = await buildDocx(para(run("Damages are ") + ins(700, OUR, run("fifty percent (50%)"))));
    const output = await buildDocx(
      para(run("Damages are ") + ins(700, OUR, run("fifty percent (50%)")) + ins(9001, OUR, run(" of revenue")))
    );

    const report = await validate(original, output, { ownRevisionIds: ["9001"] });
    expect(checkFor(report, "reject_round_trip")?.passed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// The oracle must survive what it is given.
// ---------------------------------------------------------------------------

describe("robustness", () => {
  it("reports rather than throws when the output is not a Word archive", async () => {
    const report = await validate(await buildDocx(para(run(CLAUSE))), new TextEncoder().encode("not a zip"));
    expect(checkFor(report, "archive_readable")?.passed).toBe(false);
    expect(report.outcome).toBe("fallback");
  });

  it("reports rather than throws when the original cannot be re-read", async () => {
    const report = await validate(new TextEncoder().encode("not a zip"), await buildDocx(para(OUR_EDIT)));
    expect(report.outcome).toBe("fallback");
    expect(report.fallbackReason).toMatch(/could not be re-read/);
  });
});
