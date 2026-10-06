import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  analyzeContract,
  draftEvalClauses,
  extractContractTerms,
  generateClientEmail,
  generatePropertyEmail,
  historicalRequest,
  readBackEvalTerms,
} from "@/lib/anthropic";
import { STANDARDS_LIBRARY, STANDARDS_LIBRARY_VERSION } from "@/lib/standards/v1";
import { MUST_RAISE_CATALOG } from "@/lib/review";
import { HOTEL_TERM_CATALOG } from "@/lib/terms/catalog";

/**
 * The exact request each model call sends, pinned byte for byte.
 *
 * A change to any prompt, tool schema or payload changes what every review
 * says, and nothing downstream would notice. These goldens make that change
 * fail loudly instead. Updating one (`vitest -u`) is a deliberate decision to
 * change the model's output, so it needs its own reason in the commit.
 */

const { create } = vi.hoisted(() => ({ create: vi.fn() }));

vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = { create, stream: (params: unknown) => ({ finalMessage: () => create(params) }) };
  },
}));

const toolResponse = (input: unknown) => ({
  content: [{ type: "tool_use", id: "toolu_golden", name: "tool", input }],
  stop_reason: "tool_use",
  usage: { input_tokens: 0, output_tokens: 0 },
});

/** Sonnet 5 is forced to its tool. Sonnet 5.5 can't be, so its requests differ. */
const MODELS = [
  { model: "claude-sonnet-5", suffix: "" },
  { model: "claude-sonnet-5-5", suffix: "-sonnet-5-5" },
];

beforeEach(() => {
  create.mockReset();
  vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
});

describe.each(MODELS)("request goldens ($model)", ({ model: MODEL, suffix }) => {
  it("analysis", async () => {
    create.mockResolvedValue(toolResponse({ clause_review: [], findings: [], document_notes: "" }));

    await analyzeContract({
      document: { kind: "text", text: "CONTRACT BODY" },
      standards: STANDARDS_LIBRARY,
      standardsVersion: STANDARDS_LIBRARY_VERSION,
      contextNote: "CONTEXT NOTE",
      model: MODEL,
    });

    await expect(JSON.stringify(create.mock.calls[0][0], null, 2)).toMatchFileSnapshot(
      `./fixtures/prompt-golden/analysis-request${suffix}.json`
    );
  });

  it("analysis with comments adds one block after the contract and changes nothing else", async () => {
    create.mockResolvedValue(toolResponse({ clause_review: [], findings: [], document_notes: "" }));
    const args = {
      document: { kind: "text" as const, text: "CONTRACT BODY" },
      standards: STANDARDS_LIBRARY,
      standardsVersion: STANDARDS_LIBRARY_VERSION,
      contextNote: "CONTEXT NOTE",
      model: MODEL,
    };

    await analyzeContract(args);
    await analyzeContract({
      ...args,
      comments: [
        {
          id: "21",
          author: "Dana Reyes",
          date: "2026-02-14T10:30:00Z",
          text: "Subject to negotiation.",
          part: "document",
          start: 31,
          end: 32,
          quoted: "8",
          context: "Hotel will pay a commission of 8% of the group room rate.",
          replyTo: null,
          resolved: false,
        },
      ],
    });

    const [plain, withComments] = create.mock.calls.map((c) => c[0]);
    const { messages: plainMessages, ...plainRest } = plain;
    const { messages, ...rest } = withComments;

    expect(rest).toEqual(plainRest);
    expect(messages[0].content).toHaveLength(plainMessages[0].content.length + 1);
    await expect(JSON.stringify(messages, null, 2)).toMatchFileSnapshot(
      "./fixtures/prompt-golden/analysis-comments-messages.json"
    );
  });

  it("analysis with a picture adds a label and the image after the contract text", async () => {
    create.mockResolvedValue(toolResponse({ clause_review: [], findings: [], document_notes: "" }));

    await analyzeContract({
      document: { kind: "text", text: "CONTRACT BODY", pictures: [{ near: "Room Block", mediaType: "image/png", data: "iVBORw0K" }] },
      standards: STANDARDS_LIBRARY,
      standardsVersion: STANDARDS_LIBRARY_VERSION,
      contextNote: "CONTEXT NOTE",
      model: MODEL,
    });

    expect(create.mock.calls[0][0].messages[0].content).toEqual([
      { type: "text", text: "CONTRACT TEXT:\n\nCONTRACT BODY" },
      { type: "text", text: 'PICTURE 1 from the contract, just after "Room Block":' },
      { type: "image", source: { type: "base64", media_type: "image/png", data: "iVBORw0K" } },
      { type: "text", text: "CONTEXT NOTE" },
    ]);
  });

  it("client email", async () => {
    create.mockResolvedValue(toolResponse({ subject: "s", body: "b" }));

    await generateClientEmail({
      findings: [
        {
          clause_type: "attrition",
          severity: "high",
          category: "business",
          is_missing_clause: false,
          quoted_text: "eighty percent (80%)",
          language: "seventy percent (70%)",
          finding_text: "Threshold too high.",
          exposure_amount: 12000,
          exposure_basis: "10% of block at $200",
        },
      ],
      associateName: "Jane Associate",
      contractLabel: "Hotel Example — Annual Meeting",
      model: MODEL,
    });

    await expect(JSON.stringify(create.mock.calls[0][0], null, 2)).toMatchFileSnapshot(
      `./fixtures/prompt-golden/client-email-request${suffix}.json`
    );
  });

  it("property email", async () => {
    create.mockResolvedValue(toolResponse({ subject: "s", body: "b" }));

    await generatePropertyEmail({
      items: [{ clause_type: "attrition", is_missing_clause: false, proposed_language: "seventy percent (70%)" }],
      propertyLabel: "Hotel Example",
      model: MODEL,
    });

    await expect(JSON.stringify(create.mock.calls[0][0], null, 2)).toMatchFileSnapshot(
      `./fixtures/prompt-golden/property-email-request${suffix}.json`
    );
  });

  it("term extraction", async () => {
    create.mockResolvedValue(toolResponse({ terms: [] }));

    await extractContractTerms({
      document: { kind: "text", text: "CONTRACT BODY" },
      catalog: HOTEL_TERM_CATALOG,
      model: MODEL,
    });

    await expect(JSON.stringify(create.mock.calls[0][0], null, 2)).toMatchFileSnapshot(
      `./fixtures/prompt-golden/term-extraction-request${suffix}.json`
    );
  });

  // The reading call of a review while exposure math is archived: the five terms the app raises findings from.
  it("reading call, must-raise terms", async () => {
    create.mockResolvedValue(toolResponse({ terms: [] }));

    await extractContractTerms({
      document: { kind: "text", text: "CONTRACT BODY" },
      catalog: MUST_RAISE_CATALOG,
      model: MODEL,
    });

    await expect(JSON.stringify(create.mock.calls[0][0], null, 2)).toMatchFileSnapshot(
      `./fixtures/prompt-golden/reading-must-raise-request${suffix}.json`
    );
  });

  it("historical contract", async () => {
    const request = historicalRequest({ document: { kind: "text", text: "CONTRACT BODY" }, catalog: HOTEL_TERM_CATALOG, model: MODEL });
    await expect(JSON.stringify(request, null, 2)).toMatchFileSnapshot(
      `./fixtures/prompt-golden/historical-contract-request${suffix}.json`
    );
  });

  it("eval clause draft", async () => {
    create.mockResolvedValue(toolResponse({ clauses: [] }));

    await draftEvalClauses({
      hotel: "Hotel Example",
      group: "Example Association",
      city: "Tampa",
      state: "FL",
      dates: "March 3-6, 2027",
      voice: "terse",
      clauses: [
        {
          clause_type: "attrition",
          section_title: "Attrition",
          fields: [{ field: "threshold", label: "Attrition threshold", directive: 'State the threshold as "eighty percent (80%)".' }],
        },
      ],
      model: MODEL,
    });

    await expect(JSON.stringify(create.mock.calls[0][0], null, 2)).toMatchFileSnapshot(
      `./fixtures/prompt-golden/eval-draft-request${suffix}.json`
    );
  });

  it("eval term read-back", async () => {
    create.mockResolvedValue(toolResponse({ answers: [] }));

    await readBackEvalTerms({
      contractText: "CONTRACT BODY",
      questions: [{ id: "q1", question: "Does the contract allow resale of unused rooms?", options: ["yes", "no", "unstated"] }],
      model: MODEL,
    });

    await expect(JSON.stringify(create.mock.calls[0][0], null, 2)).toMatchFileSnapshot(
      `./fixtures/prompt-golden/eval-readback-request${suffix}.json`
    );
  });
});
