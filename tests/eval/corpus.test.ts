import { describe, it, expect } from "vitest";
import { extractDocx } from "@/lib/docx";
import { buildContractDocx, type ContractDocument } from "@/lib/eval/corpus/docx-builder";
import { EVAL_SPECS } from "@/lib/eval/corpus/specs";
import { buildDirectives } from "@/lib/eval/corpus/directives";
import { clausesToDraft, layOutContract, isTableOnly } from "@/lib/eval/corpus/layout";
import {
  buildContract,
  checkDraftBatch,
  readBackQuestions,
  normalizeClauseTypes,
  CorpusIntegrityError,
  type DraftDeps,
} from "@/lib/eval/corpus/draft";
import type { ClauseDraftRequest, DraftedClauseResult } from "@/lib/anthropic";
import type { EvalContractSpec } from "@/lib/eval/corpus/spec";

/**
 * The corpus pipeline, exercised end to end without touching the API.
 *
 * A stand-in drafter writes prose the way a compliant model would — every
 * dictated figure reproduced, every anchor a real substring — so layout, OOXML
 * assembly, extraction and anchor resolution all run for real. Only the wording
 * is fake, and the wording is the one part the gate does not trust anyway.
 */

/** Prose a model that followed every directive would produce. */
function compliantDrafter(): DraftDeps["draftClauses"] {
  return async ({ clauses }) => ({
    clauses: clauses.map((clause) => {
      const anchors = clause.fields.map((field) => {
        const dictated = field.directive.match(/"([^"]+)"/)?.[1];
        const body = dictated
          ? `the Agreement provides ${dictated} as its operative term`
          : `the Agreement provides that ${field.directive
              .replace(/^Say, in your own words(?:,)?\s*(?:that\s+)?:?\s*/i, "")
              .replace(/\.$/, "")}`;
        // Clause and field names keep every sentence unique, which is what the
        // gate's one-place-only rule requires.
        return {
          field: field.field,
          sentence: `In respect of ${clause.clause_type} ${field.field}, ${body}.`,
        };
      });
      return {
        clause_type: clause.clause_type,
        paragraphs: [anchors.map((a) => a.sentence).join(" ")],
        anchors,
      };
    }),
    model_id: "stand-in",
    input_tokens: 0,
    output_tokens: 0,
  });
}

/** A reader that agrees with the spec, so the read-back gate passes. */
function agreeingReader(spec: EvalContractSpec): DraftDeps["readBack"] {
  const expected = new Map(readBackQuestions(spec).map((q) => [q.id, q.expected]));
  return async ({ questions }) => ({
    answers: questions.map((q) => ({ id: q.id, answer: expected.get(q.id) ?? "unstated", quote: "" })),
    model_id: "stand-in",
    input_tokens: 0,
    output_tokens: 0,
  });
}

describe("buildContractDocx", () => {
  const doc: ContractDocument = {
    title: "GROUP SALES AGREEMENT",
    blocks: [
      { kind: "heading", level: 1, text: "1. Attrition" },
      { kind: "para", text: "Attrition is measured on a night-by-night basis." },
      { kind: "table", header: ["Band", "Damages"], rows: [["30 days or fewer", "100%"]] },
      { kind: "pageBreak" },
      { kind: "heading", level: 1, text: "2. Signatures" },
    ],
    header: "Harborview Grand Hotel — Group Agreement",
    footer: "Reservations close thirty days prior to arrival.",
  };

  it("produces byte-identical output across builds", async () => {
    const [a, b] = await Promise.all([buildContractDocx({ ...doc }), buildContractDocx({ ...doc })]);
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
  });

  it("round-trips headings, prose, tables, header and footer through extraction", async () => {
    const extracted = await extractDocx(await buildContractDocx({ ...doc }));

    expect(extracted.document.text).toContain("1. Attrition");
    expect(extracted.document.text).toContain("Attrition is measured on a night-by-night basis.");
    expect(extracted.document.text).toContain("100%");

    const parts = extracted.parts.map((p) => p.part);
    expect(parts).toContain("header1");
    expect(parts).toContain("footer1");
    expect(extracted.parts.find((p) => p.part === "footer1")!.text).toContain("thirty days prior");
  });

  it("omits the header and footer parts when the document has none", async () => {
    const extracted = await extractDocx(
      await buildContractDocx({ title: "T", blocks: [{ kind: "para", text: "Body." }] })
    );
    expect(extracted.parts.map((p) => p.part)).toEqual(["document"]);
  });

  it("passes the intake health gate, so the corpus takes the same route as a real upload", async () => {
    const extracted = await extractDocx(await buildContractDocx({ ...doc }));
    expect(extracted.health.route).toBe("docx_native");
  });
});

describe("checkDraftBatch", () => {
  const spec = EVAL_SPECS.find((s) => s.id === "eval-01-harborview")!;
  const request: ClauseDraftRequest = {
    clause_type: "cutoff_date",
    section_title: "Reservation Cutoff Date",
    fields: buildDirectives("cutoff_date", spec.terms.cutoff_date as Record<string, never>),
  };

  const good: DraftedClauseResult = {
    clause_type: "cutoff_date",
    paragraphs: [
      "The cutoff is forty-five (45) days prior to arrival. Rooms requested later go to rack rate.",
    ],
    anchors: [
      { field: "days_prior", sentence: "The cutoff is forty-five (45) days prior to arrival." },
      { field: "post_cutoff_group_rate", sentence: "Rooms requested later go to rack rate." },
    ],
  };

  it("accepts a batch that follows every directive", () => {
    expect(checkDraftBatch(spec, [request], [good])).toEqual([]);
  });

  it("catches a clause the model did not return", () => {
    expect(checkDraftBatch(spec, [request], [])).toEqual(["cutoff_date: not returned"]);
  });

  it("catches an anchor that is not really in the prose", () => {
    const drifted = { ...good, anchors: [{ ...good.anchors[0], sentence: "The cutoff is 45 days out." }, good.anchors[1]] };
    expect(checkDraftBatch(spec, [request], [drifted])).toEqual([
      "cutoff_date.days_prior: anchor sentence is not a substring of the prose",
    ]);
  });

  it("tolerates a sentence the model reflowed when copying it back", () => {
    // Only the whitespace differs. locateQuote matches that at the normalized
    // tier anyway, so rejecting it would re-draft a clause to fix a line break.
    const reflowed = {
      ...good,
      anchors: [
        { field: "days_prior", sentence: "The cutoff is forty-five (45)\n  days prior to arrival." },
        good.anchors[1],
      ],
    };
    expect(checkDraftBatch(spec, [request], [reflowed])).toEqual([]);
  });

  it("catches a dictated figure the sentence dropped", () => {
    const paraphrased: DraftedClauseResult = {
      clause_type: "cutoff_date",
      paragraphs: ["The cutoff is 45 days prior to arrival. Rooms requested later go to rack rate."],
      anchors: [
        { field: "days_prior", sentence: "The cutoff is 45 days prior to arrival." },
        good.anchors[1],
      ],
    };
    expect(checkDraftBatch(spec, [request], [paraphrased])).toEqual([
      'cutoff_date.days_prior: anchor sentence omits the dictated wording "forty-five (45) days"',
    ]);
  });

  it("catches a missing anchor and empty prose", () => {
    expect(checkDraftBatch(spec, [request], [{ ...good, anchors: [good.anchors[0]] }])).toEqual([
      "cutoff_date.post_cutoff_group_rate: no anchor sentence returned",
    ]);
    expect(checkDraftBatch(spec, [request], [{ ...good, paragraphs: ["  "] }])).toEqual([
      "cutoff_date: empty prose",
    ]);
  });

  it("catches markdown the drafter was told not to write", () => {
    const withMarkdown = { ...good, paragraphs: ["# Cutoff\n" + good.paragraphs[0]] };
    expect(checkDraftBatch(spec, [request], [withMarkdown])).toContain(
      "cutoff_date: prose contains a heading, bullet or list marker"
    );
  });
});

describe("readBackQuestions", () => {
  it("asks about every boolean and enum term, in both polarities", () => {
    const spec = EVAL_SPECS.find((s) => s.id === "eval-01-harborview")!;
    const questions = readBackQuestions(spec);

    expect(questions.find((q) => q.id === "attrition.audit_rights")!.expected).toBe("no");
    expect(questions.find((q) => q.id === "attrition.basis")!.expected).toBe("night_by_night");
    // eval-01 denies Group almost everything, but one adverse term is adverse
    // when true — comp rooms ARE forfeited on attrition — so "yes" appears.
    expect(questions.find((q) => q.id === "rebates.forfeited_on_attrition")!.expected).toBe("yes");
    expect(questions.filter((q) => q.expected === "no").length).toBeGreaterThan(30);

    const compliant = EVAL_SPECS.find((s) => s.id === "eval-03-bayfront")!;
    expect(readBackQuestions(compliant).filter((q) => q.expected === "yes").length).toBeGreaterThan(30);
  });

  it("asks whether an absent clause is really absent", () => {
    const spec = EVAL_SPECS.find((s) => s.id === "eval-05-riverwalk")!;
    const question = readBackQuestions(spec).find((q) => q.id === "named_storm#present")!;
    expect(question.expected).toBe("no");
    expect(question.question).toContain("named storm");
  });

  it("never offers unstated as a correct answer", () => {
    for (const spec of EVAL_SPECS) {
      expect(readBackQuestions(spec).every((q) => q.expected !== "unstated")).toBe(true);
    }
  });
});

describe("layOutContract", () => {
  it("keeps the cancellation top tier out of the prose, so it lives only in the table", () => {
    expect(isTableOnly("cancellation", "top_tier_pct")).toBe(true);
    const spec = EVAL_SPECS[0];
    const fields = buildDirectives("cancellation", spec.terms.cancellation as Record<string, never>);
    expect(fields.map((f) => f.field)).not.toContain("top_tier_pct");
  });

  it("skips absent clauses and numbers the sections it keeps", () => {
    const spec = EVAL_SPECS.find((s) => s.id === "eval-05-riverwalk")!;
    const drafted = clausesToDraft(spec).map((clause_type) => ({
      clause_type,
      paragraphs: [`Prose for ${clause_type}.`],
      anchors: [],
    }));
    const { document } = layOutContract(spec, drafted);
    const headings = document.blocks.filter((b) => b.kind === "heading").map((b) => b.text);

    expect(headings.some((h) => h.includes("Named Storm"))).toBe(false);
    expect(headings.some((h) => h.includes("Attrition"))).toBe(true);
    expect(headings[1]).toBe("1. Room Block and Rates");
  });
});

describe("buildContract", () => {
  // eval-12 covers prose anchors, a term carried in the footer, and the full
  // extract-and-locate round trip, without being the largest contract.
  const spec = EVAL_SPECS.find((s) => s.id === "eval-12-granite-bay")!;

  it("builds a document whose every anchor resolves to one exact place", async () => {
    const result = await buildContract(spec, {
      draftClauses: compliantDrafter(),
      readBack: agreeingReader(spec),
    });

    expect(result.anchors.length).toBeGreaterThan(30);
    expect(result.retries).toEqual([]);

    const parts = new Map(result.extracted.parts.map((p) => [p.part, p.text]));
    for (const anchor of result.anchors) {
      const text = parts.get(anchor.span.part)!;
      expect(text.slice(anchor.span.start, anchor.span.end)).toBe(anchor.text);
    }
  });

  it("rejects a draft that quietly changes a figure", async () => {
    const dropsFigures: DraftDeps["draftClauses"] = async (args) => {
      const honest = await compliantDrafter()(args);
      return {
        ...honest,
        clauses: honest.clauses.map((clause) => {
          const anchors = clause.anchors.map((a) => ({
            ...a,
            sentence: a.sentence.replace(/\(\d+%?\)/g, "(99%)"),
          }));
          return { ...clause, paragraphs: [anchors.map((a) => a.sentence).join(" ")], anchors };
        }),
      };
    };

    await expect(
      buildContract(spec, { draftClauses: dropsFigures, readBack: agreeingReader(spec) })
    ).rejects.toThrow(CorpusIntegrityError);
  });

  it("rejects a document the reader disagrees with about a boolean term", async () => {
    const contrarian: DraftDeps["readBack"] = async ({ questions }) => ({
      answers: questions.map((q) => ({ id: q.id, answer: "unstated", quote: "" })),
      model_id: "stand-in",
      input_tokens: 0,
      output_tokens: 0,
    });

    await expect(
      buildContract(spec, { draftClauses: compliantDrafter(), readBack: contrarian })
    ).rejects.toThrow(/the contract reads as "unstated"/);
  });
});

describe("normalizeClauseTypes", () => {
  const requests: ClauseDraftRequest[] = [
    { clause_type: "fb_minimum", section_title: "Food and Beverage Minimum", fields: [] },
    { clause_type: "cutoff_date", section_title: "Reservation Cutoff Date", fields: [] },
  ];

  it("relabels a clause returned under its section title", () => {
    const drafted = [{ clause_type: "Food and Beverage Minimum", paragraphs: ["x"], anchors: [] }];
    expect(normalizeClauseTypes(requests, drafted)[0].clause_type).toBe("fb_minimum");
  });

  it("leaves a correct identifier alone and matches the title case-insensitively", () => {
    const drafted = [
      { clause_type: "cutoff_date", paragraphs: ["x"], anchors: [] },
      { clause_type: "  food and beverage minimum ", paragraphs: ["x"], anchors: [] },
    ];
    expect(normalizeClauseTypes(requests, drafted).map((c) => c.clause_type)).toEqual([
      "cutoff_date",
      "fb_minimum",
    ]);
  });

  it("leaves a label matching neither, so the batch check still rejects it", () => {
    const drafted = [{ clause_type: "Something Else", paragraphs: ["x"], anchors: [] }];
    expect(normalizeClauseTypes(requests, drafted)[0].clause_type).toBe("Something Else");
  });
});
