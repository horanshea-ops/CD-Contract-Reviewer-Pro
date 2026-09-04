import Anthropic from "@anthropic-ai/sdk";
import { STANDARDS_LIBRARY, STANDARDS_LIBRARY_VERSION } from "./standards/v1";

/**
 * THE single module for outbound calls to the model. Non-negotiable #5 in the
 * build brief: every request to Anthropic goes through this one file, so that
 * things like client-identifier redaction can be added here later without
 * hunting through the codebase for every call site.
 */

export type Severity = "high" | "medium" | "low" | "note";

export interface Finding {
  clause_type: string;
  is_missing_clause: boolean;
  severity: Severity;
  location_section: string | null;
  quoted_text: string | null;
  exposure_amount: number | null;
  exposure_basis: string | null;
  finding_text: string;
  cd_standard: string;
  proposed_language: string;
  model_confidence: "high" | "medium" | "low";
}

export interface AnalysisResult {
  findings: Finding[];
  clauses_checked: string[];
  document_notes: string;
  model_id: string;
  standards_library_version: string;
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens: number;
  cache_creation_input_tokens: number;
}

const FINDINGS_TOOL_NAME = "record_analysis";

const FINDINGS_TOOL_SCHEMA = {
  name: FINDINGS_TOOL_NAME,
  description:
    "Record the findings from reviewing this hotel/venue contract against ConferenceDirect's standards library.",
  input_schema: {
    type: "object" as const,
    properties: {
      findings: {
        type: "array",
        items: {
          type: "object",
          properties: {
            clause_type: { type: "string" },
            is_missing_clause: { type: "boolean" },
            severity: { type: "string", enum: ["high", "medium", "low", "note"] },
            location_section: { type: ["string", "null"] },
            quoted_text: {
              type: ["string", "null"],
              description:
                "Verbatim span copied exactly from the contract text. Null only if is_missing_clause is true.",
            },
            exposure_amount: {
              type: ["number", "null"],
              description: "Dollar exposure if calculable. Null if not quantifiable — never invent a number.",
            },
            exposure_basis: { type: ["string", "null"] },
            finding_text: { type: "string" },
            cd_standard: { type: "string" },
            proposed_language: { type: "string" },
            model_confidence: { type: "string", enum: ["high", "medium", "low"] },
          },
          required: [
            "clause_type",
            "is_missing_clause",
            "severity",
            "finding_text",
            "cd_standard",
            "proposed_language",
            "model_confidence",
          ],
        },
      },
      clauses_checked: {
        type: "array",
        items: { type: "string" },
        description: "Every clause type from the standards library that was checked, found or not.",
      },
      document_notes: {
        type: "string",
        description: "Anything about the document itself worth flagging (illegible pages, unusual structure, etc.)",
      },
    },
    required: ["findings", "clauses_checked", "document_notes"],
  },
};

function buildSystemPrompt() {
  const instructions = `You are reviewing a hotel or venue contract on behalf of ConferenceDirect (CD), a meetings and events company. Your job is to find terms that create financial exposure for CD's client, measured against the standards library below, which encodes how CD negotiates.

Rules:
- This is a negotiating aid, not legal advice. Do not describe any finding as a legal opinion, and do not state or imply that a contract is "safe" or "cleared."
- For every clause type in the standards library, check whether the contract's language matches CD's position. If it does not, or the clause is missing entirely, record a finding.
- quoted_text must be copied verbatim from the contract — do not paraphrase it. If the clause is entirely missing, set is_missing_clause to true and leave quoted_text null.
- exposure_amount must be a real, calculable number based on figures actually present in the contract (room rates, block size, F&B minimums, etc.). If you cannot calculate a number from the document, leave it null. Never estimate or invent a figure.
- List every clause type you checked in clauses_checked, whether or not it produced a finding — this is how the reviewer knows what was actually reviewed.
- proposed_language should be ready to paste into a memo back to the property, adapted from the standards library's fallback language to fit this contract's specifics where relevant.`;

  const libraryBlock = `\n\nSTANDARDS LIBRARY (version ${STANDARDS_LIBRARY_VERSION}):\n${JSON.stringify(
    STANDARDS_LIBRARY,
    null,
    2
  )}`;

  return [
    {
      type: "text" as const,
      text: instructions,
    },
    {
      type: "text" as const,
      text: libraryBlock,
      cache_control: { type: "ephemeral" as const },
    },
  ];
}

export interface AnalyzeContractPdfArgs {
  pdfBase64: string;
  contextNote?: string;
  model?: string;
}

export async function analyzeContractPdf({
  pdfBase64,
  contextNote,
  model,
}: AnalyzeContractPdfArgs): Promise<AnalysisResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY is not set. Add it to .env.local (see .env.local.example)."
    );
  }

  const client = new Anthropic({ apiKey });
  const modelId = model || process.env.ANTHROPIC_MODEL || "claude-sonnet-5";

  const userContent: Anthropic.Messages.ContentBlockParam[] = [
    {
      type: "document",
      source: {
        type: "base64",
        media_type: "application/pdf",
        data: pdfBase64,
      },
    },
  ];

  if (contextNote) {
    userContent.push({ type: "text", text: contextNote });
  }

  async function attempt(): Promise<AnalysisResult> {
    const response = await client.messages.create({
      model: modelId,
      max_tokens: 16000,
      system: buildSystemPrompt(),
      tools: [FINDINGS_TOOL_SCHEMA],
      tool_choice: { type: "tool", name: FINDINGS_TOOL_NAME },
      messages: [{ role: "user", content: userContent }],
    });

    const toolUseBlock = response.content.find(
      (block): block is Anthropic.Messages.ToolUseBlock => block.type === "tool_use"
    );

    if (!toolUseBlock) {
      throw new Error("Model did not return structured findings (no tool_use block in response).");
    }

    const parsed = toolUseBlock.input as {
      findings?: Finding[];
      clauses_checked?: string[];
      document_notes?: string;
    };

    // tool_choice makes this reliable, not guaranteed — the model can still
    // omit a required field. Validate the shape rather than trusting it, per
    // build brief §5: "model returned invalid JSON (retry once, then fail
    // visibly)".
    if (!Array.isArray(parsed.findings) || !Array.isArray(parsed.clauses_checked)) {
      throw new Error(
        `Model returned malformed JSON (missing findings or clauses_checked array). stop_reason=${response.stop_reason}, output_tokens=${response.usage.output_tokens}`
      );
    }

    const usage = response.usage;

    return {
      findings: parsed.findings,
      clauses_checked: parsed.clauses_checked,
      document_notes: parsed.document_notes ?? "",
      model_id: modelId,
      standards_library_version: STANDARDS_LIBRARY_VERSION,
      input_tokens: usage.input_tokens,
      output_tokens: usage.output_tokens,
      cache_read_input_tokens: usage.cache_read_input_tokens ?? 0,
      cache_creation_input_tokens: usage.cache_creation_input_tokens ?? 0,
    };
  }

  try {
    return await attempt();
  } catch (err) {
    console.error("analyzeContractPdf: first attempt failed, retrying once —", err);
    return await attempt();
  }
}
