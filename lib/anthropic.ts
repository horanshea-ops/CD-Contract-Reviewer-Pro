import Anthropic from "@anthropic-ai/sdk";
import type { StandardEntry } from "./standards/types";
import type { EmailFinding } from "./email-drafting/input-assembly";
import type { PropertyEmailItem } from "./email-drafting/property-assembly";

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

function buildSystemPrompt(standards: StandardEntry[], standardsVersion: string) {
  const instructions = `You are reviewing a hotel or venue contract on behalf of ConferenceDirect (CD), a meetings and events company. Your job is to find terms that create financial exposure for CD's client, measured against the standards library below, which encodes how CD negotiates.

Rules:
- This is a negotiating aid, not legal advice. Do not describe any finding as a legal opinion, and do not state or imply that a contract is "safe" or "cleared."
- For every clause type in the standards library, check whether the contract's language matches CD's position. If it does not, or the clause is missing entirely, record a finding.
- quoted_text must be copied verbatim from the contract — do not paraphrase it. If the clause is entirely missing, set is_missing_clause to true and leave quoted_text null.
- If the document is supplied as text, its layout markers are ours, not the contract's: "#" marks a heading, "|" separates table cells, and list numbers like "1.a" are reconstructed. Quote only the contract's own words — never include a "#", a "|", or a reconstructed list number inside quoted_text, or the quote will not be found in the original file.
- exposure_amount must be a real, calculable number based on figures actually present in the contract (room rates, block size, F&B minimums, etc.). If you cannot calculate a number from the document, leave it null. Never estimate or invent a figure.
- List every clause type you checked in clauses_checked, whether or not it produced a finding — this is how the reviewer knows what was actually reviewed.
- proposed_language should be ready to paste into a memo back to the property, adapted from the standards library's fallback language to fit this contract's specifics where relevant.`;

  const libraryBlock = `\n\nSTANDARDS LIBRARY (version ${standardsVersion}):\n${JSON.stringify(
    standards,
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

/**
 * What the model reads. DOCX uploads that pass the intake health gate send
 * extracted text, so tables reach the model as tables rather than as prose
 * flattened by a PDF conversion (§1.4.5). Everything else sends the PDF.
 */
export type AnalyzableDocument =
  | { kind: "pdf"; pdfBase64: string }
  | { kind: "text"; text: string };

export interface AnalyzeContractPdfArgs {
  document: AnalyzableDocument;
  /** The library to review against — load it with loadStandardsLibrary(). Required
   *  so no call site can silently fall back to the bundled copy (build brief §14). */
  standards: StandardEntry[];
  standardsVersion: string;
  contextNote?: string;
  model?: string;
}

export async function analyzeContract({
  document,
  standards,
  standardsVersion,
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

  const userContent: Anthropic.Messages.ContentBlockParam[] =
    document.kind === "pdf"
      ? [{ type: "document", source: { type: "base64", media_type: "application/pdf", data: document.pdfBase64 } }]
      : [{ type: "text", text: `CONTRACT TEXT:\n\n${document.text}` }];

  if (contextNote) {
    userContent.push({ type: "text", text: contextNote });
  }

  async function attempt(): Promise<AnalysisResult> {
    const response = await client.messages.create({
      model: modelId,
      max_tokens: 16000,
      system: buildSystemPrompt(standards, standardsVersion),
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
      standards_library_version: standardsVersion,
      input_tokens: usage.input_tokens,
      output_tokens: usage.output_tokens,
      cache_read_input_tokens: usage.cache_read_input_tokens ?? 0,
      cache_creation_input_tokens: usage.cache_creation_input_tokens ?? 0,
    };
  }

  try {
    return await attempt();
  } catch (err) {
    console.error("analyzeContract: first attempt failed, retrying once —", err);
    return await attempt();
  }
}

// ---------------------------------------------------------------------------
// §1.8.2/§1.8.4 — client email drafting. Same module as analyzeContract per
// the single-outbound-call-site rule at the top of this file.
// ---------------------------------------------------------------------------

const CLIENT_EMAIL_TOOL_NAME = "record_client_email";

const CLIENT_EMAIL_TOOL_SCHEMA = {
  name: CLIENT_EMAIL_TOOL_NAME,
  description:
    "Record a drafted email to CD's client summarizing the changes CD is proposing to their contract, based on the associate's review. The property has not agreed to these yet.",
  input_schema: {
    type: "object" as const,
    properties: {
      subject: { type: "string" },
      body: { type: "string", description: "Plain text email body, no HTML, no markdown formatting." },
    },
    required: ["subject", "body"],
  },
};

/**
 * Static — the rules don't vary per call, so this needs no arguments and is
 * directly testable by checking it contains each required instruction.
 * Exported for exactly that test (§1.8.2's own "explicit prompt constraint,
 * and test it").
 */
export function buildClientEmailPrompt(): string {
  return `You are drafting an email from a ConferenceDirect (CD) associate to their client, summarizing the changes CD is proposing to the client's hotel/venue contract after reviewing it.

The negotiation is not complete. The property has not agreed to any of this yet — the client may be receiving a redlined copy, not a final agreement. Describe these as proposed changes, or changes CD is requesting, never as negotiated, agreed, or final. Do not imply the property has accepted anything.

Audience: the client (not the property). This is a business update, not a legal document.

Write in plain business language — describe what changed and why it matters in practical terms, not by clause number or legal terminology. Group findings by theme (financial exposure, scheduling/flexibility, operational terms), not in document order. For each theme, state the practical impact for the client if the property agrees to the change. Where a finding has a quantified dollar exposure, include the figure and its basis.

Target one screen of text. Several findings under one theme should read as a short thematic summary, not a bulleted list of every individual finding.

End with a brief closing line (e.g. "Let me know if you have any questions.") but do not write a sign-off or the associate's name — a signature is appended separately after this text.

Prohibited, without exception:
- Any statement of legal effect (what a clause "means" legally, or its enforceability).
- Any assurance that the client is "protected" or "covered."
- Any characterization of what a clause legally requires or prevents.

This is a negotiating aid, not legal advice, and the email must never read as legal advice.`;
}

export interface ClientEmailResult {
  subject: string;
  body: string;
  model_id: string;
  input_tokens: number;
  output_tokens: number;
}

export interface GenerateClientEmailArgs {
  findings: EmailFinding[];
  associateName: string;
  contractLabel: string;
  model?: string;
}

export async function generateClientEmail({
  findings,
  associateName,
  contractLabel,
  model,
}: GenerateClientEmailArgs): Promise<ClientEmailResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is not set. Add it to .env.local (see .env.local.example).");
  }

  const client = new Anthropic({ apiKey });
  const modelId = model || process.env.ANTHROPIC_MODEL || "claude-sonnet-5";

  const findingsBlock = findings
    .map((f, i) => {
      const exposure =
        f.exposure_amount != null ? `\nExposure: $${f.exposure_amount.toLocaleString()} (${f.exposure_basis})` : "";
      return `[${i + 1}] ${f.clause_type.replace(/_/g, " ")}${f.is_missing_clause ? " (added — not present in the original)" : ""}\nProposed language: ${f.language}\nWhy it was flagged: ${f.finding_text}${exposure}`;
    })
    .join("\n\n");

  const userText = `Contract: ${contractLabel}\nAssociate: ${associateName}\n\nProposed changes to summarize (not yet agreed to by the property):\n\n${findingsBlock}`;

  async function attempt(): Promise<ClientEmailResult> {
    const response = await client.messages.create({
      model: modelId,
      max_tokens: 4000,
      system: buildClientEmailPrompt(),
      tools: [CLIENT_EMAIL_TOOL_SCHEMA],
      tool_choice: { type: "tool", name: CLIENT_EMAIL_TOOL_NAME },
      messages: [{ role: "user", content: [{ type: "text", text: userText }] }],
    });

    const toolUseBlock = response.content.find(
      (block): block is Anthropic.Messages.ToolUseBlock => block.type === "tool_use"
    );
    if (!toolUseBlock) {
      throw new Error("Model did not return a structured email draft (no tool_use block in response).");
    }

    const parsed = toolUseBlock.input as { subject?: string; body?: string };
    if (typeof parsed.subject !== "string" || typeof parsed.body !== "string") {
      throw new Error(
        `Model returned malformed JSON (missing subject or body). stop_reason=${response.stop_reason}`
      );
    }

    return {
      subject: parsed.subject,
      body: parsed.body,
      model_id: modelId,
      input_tokens: response.usage.input_tokens,
      output_tokens: response.usage.output_tokens,
    };
  }

  try {
    return await attempt();
  } catch (err) {
    console.error("generateClientEmail: first attempt failed, retrying once —", err);
    return await attempt();
  }
}

// ---------------------------------------------------------------------------
// §1.8.3 — property email drafting. Same module as analyzeContract per the
// single-outbound-call-site rule at the top of this file.
//
// The allowlist is enforced upstream, in lib/email-drafting/property-assembly.ts
// and in buildPropertyEmailPayload below, not by the prompt. The prompt still
// sets tone and forbids inventing reasoning, but nothing here relies on the
// model to withhold anything — CD's severity, exposure and rationale are never
// constructed as inputs to this call in the first place.
// ---------------------------------------------------------------------------

const PROPERTY_EMAIL_TOOL_NAME = "record_property_email";

const PROPERTY_EMAIL_TOOL_SCHEMA = {
  name: PROPERTY_EMAIL_TOOL_NAME,
  description:
    "Record a short, courteous email transmitting a marked-up contract to the property, listing the items addressed in neutral terms.",
  input_schema: {
    type: "object" as const,
    properties: {
      subject: { type: "string" },
      body: { type: "string", description: "Plain text email body, no HTML, no markdown formatting." },
    },
    required: ["subject", "body"],
  },
};

/**
 * Static — the rules don't vary per call, so this needs no arguments and is
 * directly testable by checking it contains each required instruction.
 */
export function buildPropertyEmailPrompt(): string {
  return `You are drafting a short cover email from a ConferenceDirect (CD) associate to a hotel or venue, transmitting a marked-up copy of the venue's own contract draft.

Audience: the property, which is the counterparty in this negotiation. The tone is courteous, professional and matter-of-fact. These are people the associate works with repeatedly.

Structure, in this order and nothing more:
1. A brief opening thanking them for the draft and noting that a marked-up copy is attached.
2. A short list of the items addressed, described neutrally.
3. An offer to discuss any of it.

Describe each item in neutral, factual terms — what changed, never why. "Adjusted the attrition threshold and added resale credit language" is the target. Name the subject of each change and, where it is short and concrete, the substance of the new language.

Do not state or speculate about reasoning. Never explain why a change was requested, what concerned CD, how important an item is, or how firm CD's position is. Do not write phrases like "to protect our client", "this is important to us", "we would need", or "our budget requires". You have not been given CD's reasoning and must not invent it — anything you write beyond a neutral description of the change would be a guess presented to the counterparty as CD's position.

Treat every item as equal in weight. Do not rank, prioritise, flag anything as significant or minor, or signal which items matter more.

Do not characterise the legal effect of any clause, and do not describe anything as agreed, final or accepted — these are requested changes and the property has not responded to them.

Keep it short. A few sentences plus the list. Do not restate the contract language at length.

Write only from what you were given. Do not leave bracketed placeholders such as [Group Name] or [Dates] for the sender to fill in, and do not invent a detail to fill a gap — if you were not given something, leave it out and write around it.

End with a brief line offering to discuss, but do not write a sign-off or the associate's name — a signature is appended separately after this text.`;
}

/**
 * The exact user message sent to the model, built by naming each allowed field.
 * Exported and pure so a test can assert on the real payload — that a finding
 * row carrying severity, exposure and rationale produces a payload with none of
 * it, which is what §1.8.3's "filter, not a prompt instruction" means.
 *
 * Never spread an item here.
 */
export function buildPropertyEmailPayload(items: PropertyEmailItem[], propertyLabel: string): string {
  const itemsBlock = items
    .map((item, i) => {
      const kind = item.is_missing_clause ? "added — not present in the current draft" : "revised";
      return `[${i + 1}] ${item.clause_type.replace(/_/g, " ")} (${kind})\nLanguage now proposed: ${item.proposed_language}`;
    })
    .join("\n\n");

  return `Agreement: ${propertyLabel}\n\nItems addressed in the attached markup:\n\n${itemsBlock}`;
}

export interface PropertyEmailResult {
  subject: string;
  body: string;
  model_id: string;
  input_tokens: number;
  output_tokens: number;
}

export interface GeneratePropertyEmailArgs {
  items: PropertyEmailItem[];
  propertyLabel: string;
  model?: string;
}

export async function generatePropertyEmail({
  items,
  propertyLabel,
  model,
}: GeneratePropertyEmailArgs): Promise<PropertyEmailResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is not set. Add it to .env.local (see .env.local.example).");
  }

  const client = new Anthropic({ apiKey });
  const modelId = model || process.env.ANTHROPIC_MODEL || "claude-sonnet-5";

  const userText = buildPropertyEmailPayload(items, propertyLabel);

  async function attempt(): Promise<PropertyEmailResult> {
    const response = await client.messages.create({
      model: modelId,
      max_tokens: 2000,
      system: buildPropertyEmailPrompt(),
      tools: [PROPERTY_EMAIL_TOOL_SCHEMA],
      tool_choice: { type: "tool", name: PROPERTY_EMAIL_TOOL_NAME },
      messages: [{ role: "user", content: [{ type: "text", text: userText }] }],
    });

    const toolUseBlock = response.content.find(
      (block): block is Anthropic.Messages.ToolUseBlock => block.type === "tool_use"
    );
    if (!toolUseBlock) {
      throw new Error("Model did not return a structured email draft (no tool_use block in response).");
    }

    const parsed = toolUseBlock.input as { subject?: string; body?: string };
    if (typeof parsed.subject !== "string" || typeof parsed.body !== "string") {
      throw new Error(`Model returned malformed JSON (missing subject or body). stop_reason=${response.stop_reason}`);
    }

    return {
      subject: parsed.subject,
      body: parsed.body,
      model_id: modelId,
      input_tokens: response.usage.input_tokens,
      output_tokens: response.usage.output_tokens,
    };
  }

  try {
    return await attempt();
  } catch (err) {
    console.error("generatePropertyEmail: first attempt failed, retrying once —", err);
    return await attempt();
  }
}
