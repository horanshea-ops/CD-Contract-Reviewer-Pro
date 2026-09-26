import { beforeEach, describe, expect, it, vi } from "vitest";
import { analyzeContract, extractContractTerms, generateClientEmail, generatePropertyEmail } from "@/lib/anthropic";
import { STANDARDS_LIBRARY, STANDARDS_LIBRARY_VERSION } from "@/lib/standards/v1";
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
    messages = { create };
  },
}));

const toolResponse = (input: unknown) => ({
  content: [{ type: "tool_use", id: "toolu_golden", name: "tool", input }],
  stop_reason: "tool_use",
  usage: { input_tokens: 0, output_tokens: 0 },
});

const MODEL = "claude-sonnet-5";

beforeEach(() => {
  create.mockReset();
  vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
});

describe("request goldens", () => {
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
      "./fixtures/prompt-golden/analysis-request.json"
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
      "./fixtures/prompt-golden/client-email-request.json"
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
      "./fixtures/prompt-golden/property-email-request.json"
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
      "./fixtures/prompt-golden/term-extraction-request.json"
    );
  });
});
