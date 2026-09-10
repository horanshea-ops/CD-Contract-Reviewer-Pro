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

// ---------------------------------------------------------------------------
// §2.0.1 — eval corpus drafting. Same module as analyzeContract per the
// single-outbound-call-site rule at the top of this file.
//
// These two calls build test material, never client output. The contracts they
// produce are invented, and their terms are fixed by the spec before drafting
// starts — the model supplies wording, not facts. Anything it writes is checked
// against the spec before it reaches the corpus (lib/eval/corpus/draft.ts).
// ---------------------------------------------------------------------------

/** A term the clause must state, and exactly how it must read. */
export interface ClauseFieldDirective {
  field: string;
  label: string;
  /** Plain instruction. Wording inside double quotes must be reproduced verbatim. */
  directive: string;
}

export interface ClauseDraftRequest {
  clause_type: string;
  section_title: string;
  fields: ClauseFieldDirective[];
}

export interface DraftedClauseResult {
  clause_type: string;
  paragraphs: string[];
  anchors: Array<{ field: string; sentence: string }>;
}

export interface DraftEvalClausesArgs {
  hotel: string;
  group: string;
  city: string;
  state: string;
  dates: string;
  voice: "terse" | "verbose" | "brand_boilerplate";
  clauses: ClauseDraftRequest[];
  model?: string;
}

export interface DraftEvalClausesResult {
  clauses: DraftedClauseResult[];
  model_id: string;
  input_tokens: number;
  output_tokens: number;
}

const DRAFT_TOOL_NAME = "record_clauses";

const DRAFT_TOOL_SCHEMA = {
  name: DRAFT_TOOL_NAME,
  description: "Record the drafted clauses, each with the sentence that states every required term.",
  input_schema: {
    type: "object" as const,
    properties: {
      clauses: {
        type: "array",
        items: {
          type: "object",
          properties: {
            clause_type: {
              type: "string",
              description:
                "The clause identifier exactly as the request gave it — fb_minimum, walk_relocation, and so on. Never the section title.",
            },
            paragraphs: {
              type: "array",
              items: { type: "string" },
              description: "Contract prose. Plain sentences, no headings, no numbering, no markdown.",
            },
            anchors: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  field: { type: "string" },
                  sentence: {
                    type: "string",
                    description:
                      "The one sentence stating this term, copied character for character from paragraphs above.",
                  },
                },
                required: ["field", "sentence"],
              },
            },
          },
          required: ["clause_type", "paragraphs", "anchors"],
        },
      },
    },
    required: ["clauses"],
  },
};

const VOICE_GUIDE: Record<DraftEvalClausesArgs["voice"], string> = {
  terse: "Write plainly and without ornament. Two paragraphs per clause, 130 to 190 words in total.",
  verbose:
    "Write in the dense, qualified style of hotel counsel, with subordinate clauses and defined terms. Three to four paragraphs per clause, 260 to 360 words in total.",
  brand_boilerplate:
    "Write as a large brand's standard form: formal, heavy on capitalised defined terms such as Hotel, Group and Agreement. Two to three paragraphs per clause, 200 to 290 words in total.",
};

/**
 * Static apart from the voice, so a test can assert the rules it carries.
 */
export function buildEvalDraftPrompt(voice: DraftEvalClausesArgs["voice"]): string {
  return `You are drafting clauses of a hotel group sales agreement. The agreement is fictional and is being written as test material for a contract-review tool. The hotel, the group, and every figure are invented.

You are drafting from the HOTEL's side, so the clauses favour the hotel wherever the directives say they do. Do not soften a term, add a protection the directives do not ask for, or note that a term is unusual. Write it as a hotel's own counsel would write it.

${VOICE_GUIDE[voice]}

For each clause you are given a list of terms it must state, each with a directive.

Rules, all of which matter:
- State every listed term. A term you leave out makes the clause unusable.
- Where a directive puts wording in double quotes, reproduce that wording exactly, character for character, inside your prose. Do not paraphrase it, requote it, or change its punctuation.
- State each term in exactly ONE sentence. Do not restate a figure elsewhere in the clause.
- Do not state any term the directives do not mention. In particular, never invent a percentage, a dollar amount, or a deadline that was not given to you.
- Return one anchor for EVERY term listed under a clause, using that term's identifier. A clause listing five terms gets five anchors. Leaving one out fails the clause.
- Return, for each term, the single sentence from your own prose that states it — copied character for character, including its final punctuation. This is checked mechanically, and a sentence that is not a verbatim substring of your paragraphs is rejected.
- Write contract prose only. No headings, no section numbers, no bullet points, no markdown.
- Write out numbers the way hotel contracts do, with the digits in parentheses, exactly as the directives show them.
- Return each clause under the identifier the request gave it — "fb_minimum", not "Food and Beverage Minimum". The quoted section title is only there to tell you what the clause is about.

Two things separate a real clause from a list of terms, and both are required.

First, write the machinery around the terms. A real clause says how notice is given and to whom, who calculates a figure and from what records, when an amount falls due, what happens if a party disagrees, and how the clause reads against the rest of the agreement. The required terms are the skeleton. A clause that states them and stops is not finished.

Second, where a directive begins "Say, in your own words", what follows is a NOTE ABOUT MEANING, not text to paste. It is written in plain English so you cannot mistake what the term does. Rewrite it as contract language — different sentence shape, contract vocabulary, the defined terms this agreement uses. Reproducing the note as written is a failure, and is checked.`;
}

export async function draftEvalClauses({
  hotel,
  group,
  city,
  state,
  dates,
  voice,
  clauses,
  model,
}: DraftEvalClausesArgs): Promise<DraftEvalClausesResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is not set. Add it to .env.local (see .env.local.example).");
  }

  // Four minutes, against an SDK default of ten. A drafting batch that is going
  // to succeed returns in well under a minute, so a stalled connection is worth
  // abandoning early — three stalls at the default cost half an hour before the
  // first retry got anywhere.
  // maxRetries 0 because withRetry in lib/eval/corpus/draft.ts already retries.
  // Leaving the SDK's default of 2 in place made one "attempt" up to three
  // requests at four minutes each, so three attempts became nine requests and a
  // slow patch turned into a twenty-minute stall before anything gave up.
  const client = new Anthropic({ apiKey, timeout: 240_000, maxRetries: 0 });
  // Haiku by default. Drafting with a different model than the one being
  // graded keeps the corpus from being unusually easy for the grader to read.
  const modelId = model || process.env.EVAL_DRAFT_MODEL || "claude-haiku-4-5";

  // The count is stated because the model drops an anchor now and then when
  // several clauses share a call, and a missing anchor costs a whole redraft.
  const clauseBlock = clauses
    .map(
      (clause) =>
        `CLAUSE ${clause.clause_type} — "${clause.section_title}" — ${clause.fields.length} terms, so return exactly ${clause.fields.length} anchors\n` +
        clause.fields.map((f) => `  - ${f.field} (${f.label}): ${f.directive}`).join("\n")
    )
    .join("\n\n");

  const userText = `Hotel: ${hotel}, ${city}, ${state}\nGroup: ${group}\nEvent dates: ${dates}\n\nDraft the following clauses.\n\n${clauseBlock}`;

  // Streamed. A verbose batch runs to several thousand output tokens, and the
  // same call non-streaming hit the SDK's request timeout rather than returning
  // slowly — the failure looks like an API outage and is not one.
  const response = await client.messages
    .stream({
      model: modelId,
      max_tokens: 16000,
      system: buildEvalDraftPrompt(voice),
      tools: [DRAFT_TOOL_SCHEMA],
      tool_choice: { type: "tool", name: DRAFT_TOOL_NAME },
      messages: [{ role: "user", content: [{ type: "text", text: userText }] }],
    })
    .finalMessage();

  const toolUseBlock = response.content.find(
    (block): block is Anthropic.Messages.ToolUseBlock => block.type === "tool_use"
  );
  if (!toolUseBlock) {
    throw new Error("Model did not return drafted clauses (no tool_use block in response).");
  }

  const parsed = toolUseBlock.input as { clauses?: DraftedClauseResult[] };
  if (!Array.isArray(parsed.clauses)) {
    throw new Error(`Model returned malformed clause draft. stop_reason=${response.stop_reason}`);
  }

  return {
    clauses: parsed.clauses,
    model_id: modelId,
    input_tokens: response.usage.input_tokens,
    output_tokens: response.usage.output_tokens,
  };
}

/**
 * Reading terms back out of a drafted contract, to check the draft says what
 * the spec says it says.
 *
 * Numeric terms are checked by substring against the phrasing the drafter was
 * handed, which needs no model. Booleans and enums have no such handle — a
 * clause either grants an obligation or denies it, in whatever words — so they
 * are recovered by reading, and a disagreement with the spec rejects the draft.
 *
 * Deliberately a different and stronger model than the drafter. A model
 * checking its own output shares its own blind spots.
 */
export interface TermQuestion {
  id: string;
  question: string;
  /** Allowed answers. Always includes "unstated". */
  options: string[];
}

export interface ReadBackEvalTermsArgs {
  contractText: string;
  questions: TermQuestion[];
  model?: string;
}

export interface ReadBackEvalTermsResult {
  answers: Array<{ id: string; answer: string; quote: string }>;
  model_id: string;
  input_tokens: number;
  output_tokens: number;
}

const READBACK_TOOL_NAME = "record_terms";

const READBACK_TOOL_SCHEMA = {
  name: READBACK_TOOL_NAME,
  description: "Record what the contract actually says for each term asked about.",
  input_schema: {
    type: "object" as const,
    properties: {
      answers: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: { type: "string" },
            answer: { type: "string", description: "One of the options offered for that question." },
            quote: {
              type: "string",
              description: "The wording the answer is based on, copied from the contract. Empty if unstated.",
            },
          },
          required: ["id", "answer", "quote"],
        },
      },
    },
    required: ["answers"],
  },
};

export function buildEvalReadBackPrompt(): string {
  return `You are reading a hotel group sales agreement and reporting what it says. You are not reviewing it, judging it, or suggesting changes.

For each question, answer with one of the options given for that question, and quote the wording your answer rests on.

Answer only from what the contract states. If the contract does not address a question, answer "unstated" and leave the quote empty — do not infer an answer from what a contract of this kind usually says, and do not treat silence as a "no".

Read the whole document before answering. A term may sit in an exhibit, a table, a header or a footer rather than in the clause you expect.`;
}

export async function readBackEvalTerms({
  contractText,
  questions,
  model,
}: ReadBackEvalTermsArgs): Promise<ReadBackEvalTermsResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is not set. Add it to .env.local (see .env.local.example).");
  }

  const client = new Anthropic({ apiKey, timeout: 240_000, maxRetries: 0 });
  const modelId = model || process.env.EVAL_READBACK_MODEL || "claude-sonnet-5";

  const questionBlock = questions
    .map((q) => `[${q.id}] ${q.question}\n    Options: ${q.options.join(" | ")}`)
    .join("\n");

  const response = await client.messages
    .stream({
      model: modelId,
      max_tokens: 16000,
      system: buildEvalReadBackPrompt(),
      tools: [READBACK_TOOL_SCHEMA],
      tool_choice: { type: "tool", name: READBACK_TOOL_NAME },
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: `CONTRACT:\n\n${contractText}\n\nQUESTIONS:\n\n${questionBlock}` }],
        },
      ],
    })
    .finalMessage();

  const toolUseBlock = response.content.find(
    (block): block is Anthropic.Messages.ToolUseBlock => block.type === "tool_use"
  );
  if (!toolUseBlock) {
    throw new Error("Model did not return term read-back (no tool_use block in response).");
  }

  const parsed = toolUseBlock.input as { answers?: ReadBackEvalTermsResult["answers"] };
  if (!Array.isArray(parsed.answers)) {
    throw new Error(`Model returned malformed term read-back. stop_reason=${response.stop_reason}`);
  }

  return {
    answers: parsed.answers,
    model_id: modelId,
    input_tokens: response.usage.input_tokens,
    output_tokens: response.usage.output_tokens,
  };
}
