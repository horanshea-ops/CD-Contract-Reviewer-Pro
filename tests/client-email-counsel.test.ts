import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildClientEmailPrompt, generateClientEmail } from "@/lib/anthropic";
import { assembleEmailFindings, type EmailFinding } from "@/lib/email-drafting/input-assembly";

/**
 * Legal findings in the client email. CD gives no legal advice, so a legal
 * point reaches the client as an explanation for their own counsel, with no
 * wording, and never as a change CD is requesting.
 */

const { create } = vi.hoisted(() => ({ create: vi.fn() }));

vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = { create };
  },
}));

const base: Omit<EmailFinding, "clause_type" | "category" | "language" | "finding_text"> = {
  severity: "medium",
  is_missing_clause: false,
  quoted_text: "quoted",
  exposure_amount: null,
  exposure_basis: null,
};

async function userText(findings: EmailFinding[]) {
  create.mockResolvedValueOnce({
    content: [{ type: "tool_use", id: "t", name: "record_client_email", input: { subject: "s", body: "b" } }],
    stop_reason: "tool_use",
    usage: { input_tokens: 0, output_tokens: 0 },
  });
  await generateClientEmail({ findings, associateName: "Jane", contractLabel: "Hotel" });
  return create.mock.calls[0][0].messages[0].content[0].text as string;
}

beforeEach(() => {
  create.mockReset();
  vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
});

describe("legal findings in the client email", () => {
  it("lists them apart from the changes, with the explanation and no wording", async () => {
    const text = await userText([
      { ...base, clause_type: "attrition", category: "business", language: "seventy percent (70%)", finding_text: "Threshold too high." },
      { ...base, clause_type: "general", category: "other", language: "", finding_text: "Cross-default clause." },
      { ...base, clause_type: "governing_law_venue", category: "legal", language: "", finding_text: "Disputes go to the hotel's courts." },
    ]);

    const [changes, counsel] = text.split("Points for the client's own counsel.");
    expect(changes).toContain("Proposed language: seventy percent (70%)");
    expect(changes).not.toMatch(/Proposed language: \n/);
    expect(changes).not.toContain("governing law venue");
    expect(counsel).toContain("governing law venue");
    expect(counsel).toContain("Why it may matter: Disputes go to the hotel's courts.");
    expect(counsel).not.toContain("Proposed language");
  });

  it("drops the wording from a legal finding, even one edited before categories existed", () => {
    const [finding] = assembleEmailFindings(
      [
        {
          id: "f1",
          clause_type: "governing_law_venue",
          severity: "medium",
          category: "legal",
          is_missing_clause: false,
          quoted_text: "quoted",
          finding_text: "Disputes go to the hotel's courts.",
          proposed_language: "",
          exposure_amount: null,
          exposure_basis: null,
        },
      ],
      [{ finding_id: "f1", action: "edit", edited_language: "Governed by Group's state law.", created_at: "2026-10-01" }]
    );
    expect(finding).toMatchObject({ category: "legal", language: "" });
  });

  it("tells the model to describe legal points and never suggest wording", () => {
    const prompt = buildClientEmailPrompt();
    expect(prompt).toContain("points for the client's own counsel");
    expect(prompt).toContain("Never suggest what such a term should say");
  });
});
