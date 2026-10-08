import Anthropic from "@anthropic-ai/sdk";
import { commentContext } from "./document-comments";
import type { DocumentComment } from "./docx";
import type { Category, StandardEntry } from "./standards/types";
import type { EmailFinding } from "./email-drafting/input-assembly";
import type { PropertyEmailItem } from "./email-drafting/property-assembly";
import { ORG, type OrgProfile } from "./org";
import { reconcileReview, type ClauseReview, type DroppedFinding, type ReviewGap } from "./analysis-review";
import { toNotes, type DocumentNote } from "./document-notes";
import { toOtherFindings } from "./other-findings";
import { applyCategories, toFlaggedFindings, type CategorizedFinding } from "./finding-categories";
import { DEFAULT_POSITIONS } from "./exposures/cd-positions";
import { NO_FIGURES, type DealFigures } from "./exposures/figures";
import { withComputedExposures } from "./exposures/compute";
import { currencyOf } from "./exposure";
import { formatCurrency } from "./format";
import type { TermCatalog, TermDefinition } from "./terms/types";
import type { PictureImage } from "./docx/types";

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
  /** Stamped from the library after the model answers. Absent on the model's raw output and on older saved runs. */
  category?: Category;
  location_section: string | null;
  quoted_text: string | null;
  exposure_amount: number | null;
  exposure_basis: string | null;
  /** The arithmetic behind exposure_amount. Absent on findings recorded before it was asked for. */
  exposure_formula?: string | null;
  /** Absent on findings recorded before the model was asked for one. */
  headline?: string | null;
  finding_text: string;
  cd_standard: string;
  proposed_language: string;
  /**
   * The short "why" for the redline comment, which the property reads. Business
   * findings only. Absent on findings recorded before the model was asked for one.
   */
  redline_note?: string;
  model_confidence: "high" | "medium" | "low";
}

export interface AnalysisResult {
  findings: Finding[];
  clause_review: ClauseReview[];
  clauses_checked: string[];
  review_gaps: ReviewGap[];
  dropped_findings: DroppedFinding[];
  document_notes: DocumentNote[];
  /** The contract's figures the exposures were computed from. reviewContract sets it. Absent on runs captured before them. */
  deal_figures?: DealFigures;
  model_id: string;
  standards_library_version: string;
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens: number;
  cache_creation_input_tokens: number;
  /** Characters of thinking the model wrote before its answer. Thinking is billed as output. Absent on older runs. */
  thinking_chars?: number;
}

/** A fresh review, with each finding's category stamped from the library. Saved eval runs predate categories. */
export interface CategorizedAnalysis extends AnalysisResult {
  findings: CategorizedFinding[];
}

/**
 * Models that accept a forced tool_choice. Their requests force the tool, as
 * every request did before Sonnet 5.5.
 *
 * Every other model, Sonnet 5.5 onward, rejects a forced tool_choice. Its
 * request carries no tool. The API holds the reply to the tool's schema, so
 * the answer comes back as JSON text in the same shape.
 */
const FORCED_TOOL_MODELS = new Set([
  "claude-sonnet-5",
  "claude-opus-5",
  "claude-opus-4-8",
  "claude-opus-4-7",
  "claude-opus-4-6",
  "claude-sonnet-4-6",
  "claude-haiku-4-5",
  "claude-haiku-4-5-20251001",
]);

export function forcesTool(model: string): boolean {
  return FORCED_TOOL_MODELS.has(model);
}

/**
 * Models that take thinking "between_tools", which skips the thinking ahead of
 * the answer. A forced call never thought first, so this keeps a review as
 * quick as it was. Every other model rejects the setting.
 */
const BETWEEN_TOOLS_MODELS = new Set(["claude-sonnet-5-5"]);

type Effort = NonNullable<Anthropic.Messages.OutputConfig["effort"]>;

/**
 * A tool's schema as an output format takes it. Every object is closed with
 * additionalProperties: false. An enum beside a list of types is refused, so
 * a nullable enum is written as anyOf.
 */
export function formatSchema<T>(schema: T): T {
  if (Array.isArray(schema)) return schema.map(formatSchema) as T;
  if (schema === null || typeof schema !== "object") return schema;
  const node: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(schema)) {
    node[key] = key === "enum" || key === "required" ? value : formatSchema(value);
  }

  const { type, enum: values, ...rest } = node;
  if (Array.isArray(type) && Array.isArray(values)) {
    const anyOf = type.map((t) => (t === "null" ? { type: "null" } : { type: t, enum: values.filter((v) => v !== null) }));
    return { ...rest, anyOf } as T;
  }

  if (type === "object" || (Array.isArray(type) && type.includes("object"))) node.additionalProperties = false;
  return node as T;
}

/**
 * How one call asks for its answer, shaped for the model.
 *
 * Effort is stated for an unforced model because its levels differ from
 * Sonnet 5's, and "between_tools" is refused above "high".
 */
export function answerRequest(model: string, tool: Anthropic.Messages.Tool, effort: Effort = "high") {
  if (forcesTool(model)) {
    return { tools: [tool], tool_choice: { type: "tool" as const, name: tool.name } };
  }
  return {
    ...(BETWEEN_TOOLS_MODELS.has(model) ? { thinking: { type: "between_tools" as const } } : {}),
    output_config: {
      effort,
      format: { type: "json_schema" as const, schema: formatSchema(tool.input_schema) as Record<string, unknown> },
    },
  };
}

/**
 * The system prompt, with what an unforced model needs in place of the tool:
 * a line saying the reply is the record, and the tool's description. A prompt
 * in blocks gets it at the end of its first block, the rules, ahead of the
 * cached library or catalog.
 */
export function withAnswerInstruction<T extends string | Anthropic.Messages.TextBlockParam[]>(
  system: T,
  model: string,
  tool: Anthropic.Messages.Tool
): T {
  if (forcesTool(model)) return system;
  const line = `\n\nYour whole reply is one JSON record in the required format, with nothing before or after it. ${tool.description ?? ""}`.trimEnd();
  if (typeof system === "string") return `${system}${line}` as T;
  const [first, ...rest] = system;
  return [{ ...first, text: `${first.text}${line}` }, ...rest] as T;
}

/**
 * The model's answer as an object. A forced model answers in a tool call, and
 * an unforced one in JSON text.
 */
export function readAnswer(response: Anthropic.Messages.Message, what: string): Record<string, unknown> {
  const call = response.content.find((block): block is Anthropic.Messages.ToolUseBlock => block.type === "tool_use");
  if (call) return call.input as Record<string, unknown>;

  const text = response.content
    .filter((block): block is Anthropic.Messages.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("")
    .trim();
  if (!text) throw new Error(`Model did not return ${what} (no tool_use block or JSON text in response).`);

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(
      `Model returned ${what} that isn't valid JSON. stop_reason=${response.stop_reason}, output_tokens=${response.usage.output_tokens}`
    );
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`Model returned ${what} that isn't a JSON object. stop_reason=${response.stop_reason}`);
  }
  return parsed as Record<string, unknown>;
}

/** The model declined the request. Retrying would decline the same way, so it isn't. */
export class RefusalError extends Error {}

function checkRefusal(response: Anthropic.Messages.Message, what: string) {
  if (response.stop_reason === "refusal") {
    throw new RefusalError(`The model declined to ${what}. It wasn't retried, because a retry would decline the same way.`);
  }
}

const FINDINGS_TOOL_NAME = "record_analysis";

export const findingsToolSchema = ({ name, shortName: firm }: OrgProfile = ORG) => ({
  name: FINDINGS_TOOL_NAME,
  description: `Record a review of this hotel/venue contract against ${name}'s standards library: a verdict on every clause type examined, then the deviations found.`,
  input_schema: {
    type: "object" as const,
    properties: {
      clause_review: {
        type: "array",
        description: "One entry for every clause type in the standards library, written before findings.",
        items: {
          type: "object",
          properties: {
            clause_type: { type: "string" },
            verdict: { type: "string", enum: ["meets", "falls_short", "missing", "not_applicable"] },
            basis: {
              type: "string",
              description: `One line. Each term ${firm}'s position requires, and what this contract says about it. Write "silent" where it says nothing.`,
            },
          },
          required: ["clause_type", "verdict", "basis"],
        },
      },
      findings: {
        type: "array",
        description: `Deviations on business clause types only. One entry per clause whose language falls short of ${firm}'s position, plus any clause ${firm}'s standards call for that this contract is missing. A clause that already matches ${firm}'s position does not belong here — its meets verdict in clause_review says so.`,
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
                "One unbroken span copied exactly from a single paragraph of the contract: only the whole sentences being changed, or one whole table cell or list item. Null only if is_missing_clause is true.",
            },
            headline: {
              type: "string",
              description:
                "One line, at most about 12 words, saying what is wrong in plain terms. Don't repeat the clause name, which the reviewer already sees. Don't use a figure the finding doesn't state.",
            },
            finding_text: { type: "string" },
            cd_standard: { type: "string" },
            proposed_language: {
              type: "string",
              description:
                "Contract wording that replaces everything in quoted_text: repeat what stays, leave out what goes. Always an actual change — never a note that no change is needed, and never an instruction to the reviewer.",
            },
            redline_note: {
              type: "string",
              description: `One short, neutral sentence, at most 20 words, saying what the change does for the group. It becomes a comment in the redline the hotel receives, so write it for the hotel to read. No figures, and nothing about ${firm}, its standards, positions, fallbacks or reasons.`,
            },
            model_confidence: { type: "string", enum: ["high", "medium", "low"] },
          },
          required: [
            "clause_type",
            "is_missing_clause",
            "severity",
            "quoted_text",
            "headline",
            "finding_text",
            "cd_standard",
            "proposed_language",
            "redline_note",
            "model_confidence",
          ],
        },
      },
      flagged_findings: {
        type: "array",
        description: `Deviations on legal and other clause types. These carry no contract wording: ${firm} gives no legal advice, and the reviewer decides how to raise them.`,
        items: {
          type: "object",
          properties: {
            clause_type: { type: "string" },
            is_missing_clause: { type: "boolean" },
            severity: { type: "string", enum: ["high", "medium", "low"] },
            location_section: { type: ["string", "null"] },
            quoted_text: {
              type: ["string", "null"],
              description:
                "One unbroken span copied exactly from a single paragraph of the contract: the whole sentences the finding is about. Null only if is_missing_clause is true.",
            },
            headline: {
              type: "string",
              description:
                "One line, at most about 12 words, saying what the term does to the group. Don't repeat the clause name.",
            },
            finding_text: {
              type: "string",
              description:
                "Two or three sentences: what the term does, and how it could expose the group. Never what the contract should say instead.",
            },
            model_confidence: { type: "string", enum: ["high", "medium", "low"] },
          },
          required: ["clause_type", "is_missing_clause", "severity", "headline", "finding_text", "model_confidence"],
        },
      },
      document_notes: {
        type: "array",
        description:
          "Notes about the document itself that the reviewer needs: a place it contradicts itself that you can quote on both sides, a missing exhibit, an unreadable part. Nothing the findings already say, and no table totals or night counts, which the reviewer's tool checks itself.",
        items: {
          type: "object",
          properties: {
            headline: { type: "string", description: "One sentence, at most about 15 words." },
            detail: { type: "string", description: "At most two short sentences of detail." },
          },
          required: ["headline", "detail"],
        },
      },
      other_findings: {
        type: "array",
        description: `Every term no clause type in the standards library covers that still shifts cost, liability or control onto the group, the most consequential first. Nothing a finding or document note already says.`,
        items: {
          type: "object",
          properties: {
            headline: {
              type: "string",
              description: "One line, at most about 12 words, saying what the term does to the group.",
            },
            quoted_text: {
              type: "string",
              description: "The term's wording: one unbroken span copied exactly from a single paragraph, whole sentences only.",
            },
            finding_text: {
              type: "string",
              description: "Two or three sentences: what the term lets the other side do, and what it could cost the group.",
            },
          },
          required: ["headline", "quoted_text", "finding_text"],
        },
      },
    },
    required: ["clause_review", "findings", "flagged_findings", "document_notes", "other_findings"],
  },
});

/**
 * The library as the model reads it, built field by field.
 *
 * Fallback wording goes only with business standards, so the model never sees
 * wording it could offer on a legal point. The compromise range never goes:
 * the model proposes CD's standard, and only the associate sees the fallback.
 */
export function libraryForPrompt(standards: StandardEntry[]) {
  return standards.map((s) => ({
    clause_type: s.clause_type,
    segment: s.segment,
    category: s.category,
    position: s.position,
    ...(s.category === "business" ? { fallback_language: s.fallback_language } : {}),
    walk_away_condition: s.walk_away_condition,
    severity_default: s.severity_default,
    version: s.version,
    provenance: s.provenance,
  }));
}

/**
 * Exported so a test can assert on the rules it carries, the same way the two
 * email prompts are. Changing this changes the output of every review, and the
 * rules most easily lost are the ones added after a measured failure.
 */
export function buildSystemPrompt(standards: StandardEntry[], standardsVersion: string, org: OrgProfile = ORG) {
  const { name, shortName: firm, description } = org;
  const instructions = `You are reviewing a hotel or venue contract on behalf of ${name} (${firm}), ${description}. Your job is to find terms that create financial exposure for ${firm}'s client, measured against the standards library below, which encodes how ${firm} negotiates.

Rules:
- This is a negotiating aid, not legal advice. Do not describe any finding as a legal opinion, and do not state or imply that a contract is "safe" or "cleared."
- Review every clause type in the standards library before recording any findings. Give each one entry in clause_review, with a verdict of meets, falls_short or missing and the basis for it.
- Check every term ${firm}'s position requires, not only the terms the contract's clause happens to mention. A clause that says nothing about a term ${firm}'s position requires falls short of it.
- Before giving a clause type meets, name in its basis each term the position requires and where the contract gives it. If any term is absent or narrower than the position asks, the verdict is falls_short.
- A clause type with no corresponding language anywhere in the contract is missing, and its finding sets is_missing_clause to true.
- Some clause types apply only in certain places, or only to terms the contract has. A named-storm clause matters only for hotels in hurricane or typhoon regions. A position about a deposit, fee or right the contract never creates, such as a damage deposit, or a gratuity or service charge the contract doesn't charge or marks N/A, has nothing to fix. Give such a clause type the verdict not_applicable, say why in its basis, and record no finding for it. Outside the United States, don't ask for ADA compliance by name; compare the contract's accessibility terms with the substance of the standard.
- Record a finding for every clause whose verdict is falls_short or missing, and for no other.
- Each clause type in the library has a category. A finding on a business clause type goes in findings, with proposed_language. A finding on a legal or other clause type goes in flagged_findings, which has no wording.
- ${firm} does not give legal advice. For a legal clause type, finding_text explains in plain terms what the contract's term does and how it could expose the group, so the reviewer can tell the client it may be worth raising with the client's own counsel. Never say what the contract should say instead, never suggest wording, and never call a term unenforceable, invalid or unlawful.
- For an other clause type, finding_text says what the term does and why it matters to the group, without suggesting wording.
- A clause that already matches ${firm}'s position is NOT a finding. Do not record one to show that you looked — clause_review is what shows that. Every business finding is read downstream as a change to make: it is marked up in the contract, listed in the memo to the client, and named in the email to the property. A finding reporting that a clause is fine becomes a proposed change to a clause that was already fine, sent to the hotel.
- Never write "compliant", "no change recommended", "matches ${firm}'s standard" or anything like them in finding_text or proposed_language. If that is what you would be writing, there is no finding to record.
- A deviation is a finding however narrow the margin. Compare mechanically: if the contract's term sits on the wrong side of ${firm}'s position, record it. A threshold one point the wrong side is a finding. A deadline two days late is a finding. Do not weigh whether a gap is wide enough to be worth raising — that judgement belongs to the associate reading your output, who can see the whole deal and what was traded for what. You cannot, and a narrow gap is the kind most easily missed by the person you are helping.
- Leaving a clause out of findings is a statement that it MEETS ${firm}'s position, and a meets verdict in clause_review says the same thing. Never say that about a clause that falls short by any margin at all.
- severity comes from that clause's severity_default in the standards library. Depart from it only where this contract's own facts justify it — an unusually large block, a term that compounds another — and say why in finding_text. Calling everything high is the same as calling nothing high. A narrow margin is not a reason to lower the severity, and never a reason to leave the finding out.
- headline is the one line a reviewer reads first: at most about 12 words, saying what is wrong in plain terms. Don't repeat the clause name, and don't use a figure the finding doesn't state. finding_text carries the full reasoning.
- quoted_text must be copied verbatim from the contract — do not paraphrase it. Quote only the sentences your proposal changes, each one whole, starting where a sentence starts and ending where it ends, or quote one whole table cell or list item. A quote is one unbroken stretch of a single paragraph. Never join sentences that are not next to each other, never run a quote into the next paragraph, and never shorten a quote with "..." or "…". If a clause needs changes in places that are apart, record a separate finding for each place. If the clause is entirely missing, set is_missing_clause to true and leave quoted_text null.
- If the document is supplied as text, its layout markers are ours, not the contract's: "#" marks a heading, "|" separates table cells, and list numbers like "1.a" are reconstructed. Quote only the contract's own words — never include a "#", a "|", or a reconstructed list number inside quoted_text, or the quote will not be found in the original file.
- proposed_language replaces everything in quoted_text and nothing else. Repeat word for word any quoted wording that should stay, and leave out only what should go. The reviewer's redline marks only the words that differ, so repeated wording costs nothing, while wording you leave out is struck from the contract.
- proposed_language is the contract wording itself, never advice or an instruction to the reviewer. Take every figure in it from the standards library or this contract, or work it out from them. If the wording needs a figure that neither gives, write [X] in its place rather than inventing one, and the reviewer will fill it in.
- A finding that changes wording already in the contract quotes that wording. is_missing_clause is true only when the contract has no wording on the clause at all.
- Read the closing and general paragraphs, such as "Other Provisions" or "Miscellaneous", as closely as the named clauses. One sentence there can undo a protection the contract gives elsewhere.
- ${firm} is the group's agent on this booking. A promise by the group that it used no meeting planner, agent or finder, or owes no one a commission or finder's fee, conflicts with ${firm}'s commission unless it names ${firm} as the exception. Record it as a commission finding that quotes that sentence, with wording that adds ${firm} as the exception.
- Where concessions such as complimentary or discounted rooms, suites, upgrades or credits depend on the group reaching a pickup level, compare that level with the attrition terms. A group that falls short would pay attrition and lose the concessions for the same shortfall. Record it as a rebates finding quoting the condition, with wording that removes it.
- Keep every protection the quoted wording already gives the group, such as a refund, a credit or a termination right, unless the standard replaces it with something at least as good.
- Where the contract sets out a schedule, such as cancellation fees by date, keep the schedule and move each tier to the standard's basis. Never replace a schedule with one flat figure. Where the schedule's figures sit in a table, record a finding for each table cell that changes, quoting that cell, with the new figure worked out. Once your changes are made, the wording that introduces a schedule and every figure in it must agree.
- Before recording a proposal, compare it with the contract at every tier, date and amount. It must never cost the group more than the contract does in any case.
- A deadline counted in days before arrival comes later, and gives attendees longer, the fewer days it names: 14 days before arrival is after 21 days before. Before calling a deadline a deviation, work out which date falls later and which one the standard favors.
- Work out every threshold in room nights or dollars, for both the contract and your proposal, measured the way the standard measures it. An attrition trigger is measured against the whole room block, not against a minimum the contract already sets below the block. Never propose a threshold that goes further than the standard asks.
- In document_notes, name each place the contract contradicts itself, such as two different dates for the same event. Record one only when you can quote both sides, and check any arithmetic before calling a figure wrong. The reviewer's tool checks table totals, night counts and whether dates fall in order itself, so leave those out.
- A contract often pairs an event agreement with separate terms and conditions. For each topic both parts address, such as walk, commission, finance or late charges, cancellation, renovation and deposits, compare their terms and record a note for each difference, quoting both. Also record one where a formula uses a different figure from the threshold it applies, or where a clause grants a right in one sentence and withholds it in another.
- After the standards library, read the whole contract for terms no clause type in the library covers that still shift cost, liability or control onto the group. Examples include a default under any other agreement that lets the hotel end this one; a damages waiver that protects only the hotel; a right to demand prepayment on the hotel's own judgment; a duty to answer for a third party's acts; a right to end the agreement over a minor or technical breach, such as using the hotel's name or logo without approval; the hotel keeping payment for a service it withdraws, such as ending a function without a refund; a waiver of the group's right to dispute card charges; a bonus, points or payment to an individual planner rather than the group, which can create a conflict of interest; a condition that delays when the group's notice takes effect, such as until damages are paid; or forfeiting deposits or credit when the group rebooks. Read to the end of the contract before deciding what to record. Record each in other_findings with its quote, most consequential first. Propose no wording for them, because the library takes no position on them and the reviewer decides whether to raise them. A term a library clause type covers belongs in findings, never in other_findings.
- proposed_language should be ready to paste into a memo back to the property, adapted from the standards library's fallback language to fit this contract's specifics where relevant.`;

  const libraryBlock = `\n\nSTANDARDS LIBRARY (version ${standardsVersion}):\n${JSON.stringify(
    libraryForPrompt(standards),
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
  | { kind: "text"; text: string; pictures?: PictureImage[] };

/** The contract as the review reads it: the text, then each readable picture with a label saying where it sits. */
function contractContent(document: Extract<AnalyzableDocument, { kind: "text" }>): Anthropic.Messages.ContentBlockParam[] {
  const content: Anthropic.Messages.ContentBlockParam[] = [{ type: "text", text: `CONTRACT TEXT:\n\n${document.text}` }];
  (document.pictures ?? []).forEach((picture, i) => {
    const place = picture.near ? `, just after "${picture.near}"` : "";
    content.push(
      { type: "text", text: `PICTURE ${i + 1} from the contract${place}:` },
      { type: "image", source: { type: "base64", media_type: picture.mediaType, data: picture.data } }
    );
  });
  return content;
}

export interface AnalyzeContractPdfArgs {
  document: AnalyzableDocument;
  /** The library to review against — load it with loadStandardsLibrary(). Required
   *  so no call site can silently fall back to the bundled copy (build brief §14). */
  standards: StandardEntry[];
  standardsVersion: string;
  contextNote?: string;
  model?: string;
  org?: OrgProfile;
  /** Epoch ms by which the review must finish. Each attempt stops there, and
   *  the retry is skipped when too little time is left for it. */
  deadline?: number;
  /** Comments already in the file. They reach the model in a block of their own, after the contract. */
  comments?: DocumentComment[];
  /** How many comments the file holds, when that is more than `comments` carries. */
  commentsTotal?: number;
}

/**
 * A list field from the tool input. A long response sometimes carries a list
 * as a JSON string instead, and that string is decoded rather than failing the
 * review, because a retry costs a whole second review.
 */
function listField<T>(value: unknown): T[] | null {
  if (Array.isArray(value)) return value as T[];
  if (typeof value !== "string") return null;
  try {
    const decoded: unknown = JSON.parse(value);
    return Array.isArray(decoded) ? (decoded as T[]) : null;
  } catch {
    return null;
  }
}

/** What a malformed field held, for the error that reports it. */
function describeField(value: unknown): string {
  if (value === undefined) return "absent";
  if (Array.isArray(value)) return `list of ${value.length}`;
  if (typeof value === "string") return `text of ${value.length} characters starting ${JSON.stringify(value.slice(0, 40))}`;
  return value === null ? "null" : typeof value;
}

/** A typical review takes about two minutes. A retry with less time than this
 *  would likely be cut off, so the run fails with a clear error instead. */
const MIN_RETRY_MS = 120_000;

/** An answer cut off at the output limit. Retrying would be cut off the same way, so it isn't. */
class CutOffError extends Error {}

/** A review stopped at its time limit. No time is left for a retry, so there isn't one. */
class TimeLimitError extends Error {}

/** How much of an answer a message holds, in characters. */
function answerLength(message: Anthropic.Messages.Message | undefined): number {
  return (message?.content ?? []).reduce((sum, block) => {
    if (block.type === "text") return sum + block.text.length;
    if (block.type === "tool_use") return sum + JSON.stringify(block.input ?? {}).length;
    return sum;
  }, 0);
}

/**
 * Sends a request as a stream and returns the whole message.
 *
 * Node drops a request that has heard nothing back for 300 seconds, and an
 * unstreamed review is silent until its last word. A stream carries bytes
 * from the first word on, so a long review survives.
 *
 * The SDK's timeout covers only the wait for the first byte. `limitMs` stops
 * the stream itself. The SDK's retries don't know about the limit, so they're
 * off whenever there is one.
 */
async function streamedMessage(
  client: Anthropic,
  params: Anthropic.Messages.MessageStreamParams,
  limitMs?: number
): Promise<Anthropic.Messages.Message> {
  const stream = client.messages.stream(params, limitMs === undefined ? undefined : { timeout: limitMs, maxRetries: 0 });

  let stopped = false;
  const timer =
    limitMs === undefined
      ? undefined
      : setTimeout(() => {
          stopped = true;
          stream.abort();
        }, limitMs);

  try {
    return await stream.finalMessage();
  } catch (err) {
    if (!stopped) throw err;
    throw new TimeLimitError(
      `The review was still being written when its time ran out, and it was stopped ` +
        `(${answerLength(stream.currentMessage).toLocaleString("en-US")} characters of the answer had arrived). Use Retry to run it again.`
    );
  } finally {
    clearTimeout(timer);
  }
}

export async function analyzeContract({
  document,
  standards,
  standardsVersion,
  contextNote,
  model,
  org = ORG,
  deadline,
  comments,
  commentsTotal,
}: AnalyzeContractPdfArgs): Promise<CategorizedAnalysis> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY is not set. Add it to .env.local (see .env.local.example)."
    );
  }

  const client = new Anthropic({ apiKey });
  const modelId = model || process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5";

  const userContent: Anthropic.Messages.ContentBlockParam[] =
    document.kind === "pdf"
      ? [{ type: "document", source: { type: "base64", media_type: "application/pdf", data: document.pdfBase64 } }]
      : contractContent(document);

  const commentBlock = commentContext(comments, commentsTotal);
  if (commentBlock) {
    userContent.push({ type: "text", text: commentBlock });
  }

  if (contextNote) {
    userContent.push({ type: "text", text: contextNote });
  }

  const remaining = () => (deadline === undefined ? undefined : Math.max(deadline - Date.now(), 1_000));

  async function attempt(): Promise<CategorizedAnalysis> {
    const response = await streamedMessage(
      client,
      {
        model: modelId,

        // Each finding carries full replacement language, and clause_review adds
        // a line per clause type, so output grows with the library. Sonnet 5.5
        // writes about 180 tokens a second, so this cap and the ten-minute
        // deadline are reached at about the same time.
        max_tokens: 100000,

        system: withAnswerInstruction(buildSystemPrompt(standards, standardsVersion, org), modelId, findingsToolSchema(org)),
        ...answerRequest(modelId, findingsToolSchema(org)),
        messages: [{ role: "user", content: userContent }],
      },
      // Each attempt gets what is left of the deadline. The retry below works within it too.
      remaining()
    );

    checkRefusal(response, "review this contract");

    if (response.stop_reason === "max_tokens") {
      throw new CutOffError(
        `The review ran past the model's output limit and was cut off (${response.usage.output_tokens} tokens). ` +
          `It wasn't retried, because a retry would be cut off the same way.`
      );
    }

    const input = readAnswer(response, "structured findings");
    const parsed = {
      clause_review: listField<ClauseReview>(input.clause_review),
      findings: listField<Finding>(input.findings),
      flagged_findings: toFlaggedFindings(listField(input.flagged_findings), standards),
      document_notes: toNotes(input.document_notes),
      other_findings: toOtherFindings(listField(input.other_findings), org.shortName),
    };

    // tool_choice makes this reliable, not guaranteed — the model can still
    // omit a required field. Validate the shape rather than trusting it, per
    // build brief §5: "model returned invalid JSON (retry once, then fail
    // visibly)".
    if (!parsed.findings || !parsed.clause_review) {
      throw new Error(
        `Model returned malformed JSON (missing findings or clause_review array). ` +
          `Got findings: ${describeField(input.findings)}, clause_review: ${describeField(input.clause_review)}. ` +
          `stop_reason=${response.stop_reason}, output_tokens=${response.usage.output_tokens}`
      );
    }

    const usage = response.usage;

    const reviewed = reconcileReview(
      { findings: [...parsed.findings, ...parsed.flagged_findings], clause_review: parsed.clause_review },
      standards
    );

    return {
      ...reviewed,
      // Kept out of reconcileReview, which checks findings against the library's clause types.
      // No finding carries an exposure here. reviewContract adds them from the reading pass's figures.
      findings: applyCategories(withComputedExposures([...reviewed.findings, ...parsed.other_findings], NO_FIGURES, DEFAULT_POSITIONS), standards),
      document_notes: parsed.document_notes,
      model_id: modelId,
      standards_library_version: standardsVersion,
      input_tokens: usage.input_tokens,
      output_tokens: usage.output_tokens,
      cache_read_input_tokens: usage.cache_read_input_tokens ?? 0,
      cache_creation_input_tokens: usage.cache_creation_input_tokens ?? 0,
      thinking_chars: response.content.reduce((sum, block) => sum + (block.type === "thinking" ? block.thinking.length : 0), 0),
    };
  }

  try {
    return await attempt();
  } catch (err) {
    if (err instanceof CutOffError || err instanceof RefusalError || err instanceof TimeLimitError) throw err;
    const left = remaining();
    if (left !== undefined && left < MIN_RETRY_MS) {
      const reason = err instanceof Error ? err.message : String(err);
      throw new Error(`The review failed with too little time left to try again (${reason}). Use Retry to run it again.`);
    }
    console.error("analyzeContract: first attempt failed, retrying once —", err);
    return await attempt();
  }
}

// ---------------------------------------------------------------------------
// §1.8.2/§1.8.4 — client email drafting. Same module as analyzeContract per
// the single-outbound-call-site rule at the top of this file.
// ---------------------------------------------------------------------------

const CLIENT_EMAIL_TOOL_NAME = "record_client_email";

const clientEmailToolSchema = ({ shortName: firm }: OrgProfile) => ({
  name: CLIENT_EMAIL_TOOL_NAME,
  description: `Record a drafted email to ${firm}'s client summarizing the changes ${firm} is proposing to their contract, based on the associate's review. The property has not agreed to these yet.`,
  input_schema: {
    type: "object" as const,
    properties: {
      subject: { type: "string" },
      body: { type: "string", description: "Plain text email body, no HTML, no markdown formatting." },
    },
    required: ["subject", "body"],
  },
});

/**
 * Static apart from the firm — the rules don't vary per call, so this is
 * directly testable by checking it contains each required instruction.
 * Exported for exactly that test (§1.8.2's own "explicit prompt constraint,
 * and test it").
 */
export function buildClientEmailPrompt({ name, shortName: firm }: OrgProfile = ORG): string {
  return `You are drafting an email from a ${name} (${firm}) associate to their client, summarizing the changes ${firm} is proposing to the client's hotel/venue contract after reviewing it.

The negotiation is not complete. The property has not agreed to any of this yet — the client may be receiving a redlined copy, not a final agreement. Describe these as proposed changes, or changes ${firm} is requesting, never as negotiated, agreed, or final. Do not imply the property has accepted anything.

Audience: the client (not the property). This is a business update, not a legal document.

Write in plain business language — describe what changed and why it matters in practical terms, not by clause number or legal terminology. Group findings by theme (financial exposure, scheduling/flexibility, operational terms), not in document order. For each theme, state the practical impact for the client if the property agrees to the change. Where a finding has a quantified dollar exposure, include the figure and its basis.

Target one screen of text. Several findings under one theme should read as a short thematic summary, not a bulleted list of every individual finding.

End with a brief closing line (e.g. "Let me know if you have any questions.") but do not write a sign-off or the associate's name — a signature is appended separately after this text.

Some items may be listed separately as points for the client's own counsel. ${firm} does not give legal advice and is proposing no change on these. Mention them after the proposed changes, in a sentence or two each: what the term does and why the client may want their counsel to look at it. Never suggest what such a term should say, and never present one as a change ${firm} is requesting.

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
  org?: OrgProfile;
}

export async function generateClientEmail({
  findings,
  associateName,
  contractLabel,
  model,
  org = ORG,
}: GenerateClientEmailArgs): Promise<ClientEmailResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is not set. Add it to .env.local (see .env.local.example).");
  }

  const client = new Anthropic({ apiKey });
  const modelId = model || process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5";

  const changes = findings.filter((f) => f.category !== "legal");
  const counsel = findings.filter((f) => f.category === "legal");

  const changesBlock = changes
    .map((f, i) => {
      const exposure =
        f.exposure_amount != null
          ? `\nExposure: ${formatCurrency(f.exposure_amount, currencyOf(f.exposure_formula))} (${f.exposure_basis})`
          : "";

      // A point raised without wording has no proposed language line.
      const language = f.language.trim() ? `\nProposed language: ${f.language}` : "";

      return `[${i + 1}] ${f.clause_type.replace(/_/g, " ")}${f.is_missing_clause ? " (added — not present in the original)" : ""}${language}\nWhy it was flagged: ${f.finding_text}${exposure}`;
    })
    .join("\n\n");

  // Legal points carry the explanation only. No wording is ever sent for them.
  const counselBlock = counsel
    .map((f, i) => `[${changes.length + i + 1}] ${f.clause_type.replace(/_/g, " ")}\nWhy it may matter: ${f.finding_text}`)
    .join("\n\n");

  const userText =
    `Contract: ${contractLabel}\nAssociate: ${associateName}\n\nProposed changes to summarize (not yet agreed to by the property):\n\n${changesBlock || "None."}` +
    (counselBlock ? `\n\nPoints for the client's own counsel. ${org.shortName} proposes no change on these:\n\n${counselBlock}` : "");

  async function attempt(): Promise<ClientEmailResult> {
    const response = await client.messages.create({
      model: modelId,

      // An unforced model may think first, and thinking counts toward this limit.
      max_tokens: forcesTool(modelId) ? 4000 : 16000,

      system: withAnswerInstruction(buildClientEmailPrompt(org), modelId, clientEmailToolSchema(org)),
      ...answerRequest(modelId, clientEmailToolSchema(org)),
      messages: [{ role: "user", content: [{ type: "text", text: userText }] }],
    });
    checkRefusal(response, "draft this email");

    const parsed = readAnswer(response, "a structured email draft") as { subject?: string; body?: string };
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
    if (err instanceof RefusalError) throw err;
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
 * Static apart from the firm — the rules don't vary per call, so this is
 * directly testable by checking it contains each required instruction.
 */
export function buildPropertyEmailPrompt({ name, shortName: firm }: OrgProfile = ORG): string {
  return `You are drafting a short cover email from a ${name} (${firm}) associate to a hotel or venue, transmitting a marked-up copy of the venue's own contract draft.

Audience: the property, which is the counterparty in this negotiation. The tone is courteous, professional and matter-of-fact. These are people the associate works with repeatedly.

Structure, in this order and nothing more:
1. A brief opening thanking them for the draft and noting that a marked-up copy is attached.
2. A short list of the items addressed, described neutrally.
3. An offer to discuss any of it.

Describe each item in neutral, factual terms — what changed, never why. "Adjusted the attrition threshold and added resale credit language" is the target. Name the subject of each change and, where it is short and concrete, the substance of the new language.

Do not state or speculate about reasoning. Never explain why a change was requested, what concerned ${firm}, how important an item is, or how firm ${firm}'s position is. Do not write phrases like "to protect our client", "this is important to us", "we would need", or "our budget requires". You have not been given ${firm}'s reasoning and must not invent it — anything you write beyond a neutral description of the change would be a guess presented to the counterparty as ${firm}'s position.

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
  org?: OrgProfile;
}

export async function generatePropertyEmail({
  items,
  propertyLabel,
  model,
  org = ORG,
}: GeneratePropertyEmailArgs): Promise<PropertyEmailResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is not set. Add it to .env.local (see .env.local.example).");
  }

  const client = new Anthropic({ apiKey });
  const modelId = model || process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5";

  const userText = buildPropertyEmailPayload(items, propertyLabel);

  async function attempt(): Promise<PropertyEmailResult> {
    const response = await client.messages.create({
      model: modelId,

      // An unforced model may think first, and thinking counts toward this limit.
      max_tokens: forcesTool(modelId) ? 2000 : 16000,

      system: withAnswerInstruction(buildPropertyEmailPrompt(org), modelId, PROPERTY_EMAIL_TOOL_SCHEMA),
      ...answerRequest(modelId, PROPERTY_EMAIL_TOOL_SCHEMA),
      messages: [{ role: "user", content: [{ type: "text", text: userText }] }],
    });
    checkRefusal(response, "draft this email");

    const parsed = readAnswer(response, "a structured email draft") as { subject?: string; body?: string };
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
    if (err instanceof RefusalError) throw err;
    console.error("generatePropertyEmail: first attempt failed, retrying once —", err);
    return await attempt();
  }
}

// ---------------------------------------------------------------------------
// §2.0.2 — structured term extraction. Same module as analyzeContract per the
// single-outbound-call-site rule at the top of this file.
//
// Reading, not reviewing. The model reports what the contract states, typed by
// the catalog, and everything it returns is validated and checked against the
// document in lib/terms/validate.ts before anything is stored.
// ---------------------------------------------------------------------------

const TERMS_TOOL_NAME = "record_contract_terms";

export const termsToolSchema = (catalog: TermCatalog) => ({
  name: TERMS_TOOL_NAME,
  description: "Record every term from the catalog that this contract states, each with the wording that states it.",
  input_schema: {
    type: "object" as const,
    properties: {
      terms: {
        type: "array",
        description: "One entry per stated term. Leave out any term the contract does not state.",
        items: {
          type: "object",
          properties: {
            term_key: { type: "string", enum: catalog.terms.map((t) => t.key) },
            value: {
              type: ["number", "string", "boolean", "array"],
              description:
                "Typed as the catalog says. Percentages as written (90 for 90%), dollars and counts as plain numbers, dates as YYYY-MM-DD, schedules as a list of tiers.",
              items: {
                type: "object",
                properties: {
                  label: { type: "string" },
                  days_prior_min: { type: "number" },
                  days_prior_max: { type: ["number", "null"] },
                  pct: { type: "number" },
                },
                required: ["label", "days_prior_min", "days_prior_max", "pct"],
              },
            },
            quoted_text: {
              type: "string",
              description: "The shortest span, copied verbatim from the contract, that states this value.",
            },
            source_section: { type: ["string", "null"] },
            confidence: { type: "string", enum: ["high", "medium", "low"] },
          },
          required: ["term_key", "value", "quoted_text", "confidence"],
        },
      },
    },
    required: ["terms"],
  },
});

const UNIT_WORDS: Record<string, string> = {
  pct: "percentage, as written",
  usd: "US dollars",
  days: "days",
  months: "months",
  hours: "hours",
  rooms: "rooms",
};

function describeTerm(term: TermDefinition): string {
  const type =
    term.kind === "number"
      ? `number, ${UNIT_WORDS[term.unit!]}`
      : term.kind === "enum"
        ? `one of: ${[...Object.keys(term.options ?? {}), "other"].join(" | ")}`
        : term.kind === "date"
          ? "date, YYYY-MM-DD"
          : term.kind;
  const options = Object.entries(term.options ?? {})
    .map(([value, meaning]) => `\n    ${value}: ${meaning}`)
    .join("");
  return `- ${term.key} (${type}): ${term.meaning}${options}`;
}

/**
 * Exported so a test can pin it. The catalog block is cached; the instructions
 * are not, for the same reason as the analysis prompt's library block.
 */
export function buildTermExtractionPrompt(catalog: TermCatalog) {
  const instructions = `You are reading a hotel or venue group contract and recording the terms it states. You are not reviewing it, judging it, or suggesting changes.

The catalog below lists the terms to look for. Record an entry for each one the contract states.

Rules:
- Record only what the contract states. If it does not address a term, leave that term out. Never infer a value from what contracts of this kind usually say.
- A boolean is recorded only when the contract addresses the point. False means the contract addresses it and does not grant it — it withholds it, excludes it, or leaves it to the hotel's discretion. Silence is never false.
- Record 0 only where the contract says there is no such period, fee or window. If it is silent, leave the term out.
- Take each value from wording about that term itself. Never work one term out from another: "no deposit is required" states the deposit amount and says nothing about a refund window.
- Each meaning names exactly one figure. Where a clause states several numbers, record the one the meaning describes.
- Read the whole document before answering, including tables, exhibits, headers and footers. A term may sit anywhere.
- Report percentages as the number written (90 for 90%, 1.5 for 1.5%), dollar amounts as plain numbers (289 for $289.00), days, months, hours and rooms as plain numbers, and dates as YYYY-MM-DD. For an enum, give one of the listed values, or "other" if none fits.
- quoted_text must be copied verbatim from the contract — the shortest span that states the value, usually a sentence or clause. For a value in a table, quote the one cell that holds the value itself, never the cell that labels its row or column.
- Quote one continuous span where you can. If you must shorten a long one, mark each cut with "..." and keep every piece word for word and in its original order.
- If the document is supplied as text, its layout markers are ours, not the contract's: "#" marks a heading, "|" separates table cells, and list numbers like "1.a" are reconstructed. Never include a "#", a "|", or a reconstructed list number inside quoted_text.
- If the contract states a term more than once with different values, record each as its own entry. If it repeats the same value, one entry is enough.
- source_section is the heading or section number the value sits under, or null.
- confidence is high when the wording is explicit, medium when you had to interpret it, and low when you are unsure.`;

  const catalogBlock = `\n\nTERM CATALOG (version ${catalog.version}):\n${catalog.terms.map(describeTerm).join("\n")}`;

  return [
    { type: "text" as const, text: instructions },
    { type: "text" as const, text: catalogBlock, cache_control: { type: "ephemeral" as const } },
  ];
}

export interface ExtractContractTermsArgs {
  document: AnalyzableDocument;
  catalog: TermCatalog;
  model?: string;
  /** Epoch ms by which the reading must finish, so it can never outlast the review it runs beside. */
  deadline?: number;
}

export interface ExtractContractTermsResult {
  /** Unvalidated. Pass through validateTerms before anything reads a value. */
  entries: unknown[];
  model_id: string;
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens: number;
  cache_creation_input_tokens: number;
}

export async function extractContractTerms({
  document,
  catalog,
  model,
  deadline,
}: ExtractContractTermsArgs): Promise<ExtractContractTermsResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is not set. Add it to .env.local (see .env.local.example).");
  }

  const client = new Anthropic({ apiKey });
  const modelId = model || process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5";

  const userContent: Anthropic.Messages.ContentBlockParam[] =
    document.kind === "pdf"
      ? [{ type: "document", source: { type: "base64", media_type: "application/pdf", data: document.pdfBase64 } }]
      : [{ type: "text", text: `CONTRACT TEXT:\n\n${document.text}` }];

  async function attempt(): Promise<ExtractContractTermsResult> {
    const response = await client.messages.create({
      model: modelId,
      max_tokens: 16000,
      system: withAnswerInstruction(buildTermExtractionPrompt(catalog), modelId, termsToolSchema(catalog)),
      ...answerRequest(modelId, termsToolSchema(catalog)),
      messages: [{ role: "user", content: userContent }],
    },
    // The SDK's own retries don't know about the deadline, so they're off whenever there is one.
    deadline === undefined ? undefined : { timeout: Math.max(deadline - Date.now(), 1_000), maxRetries: 0 });
    checkRefusal(response, "read this contract's terms");

    const parsed = readAnswer(response, "extracted terms") as { terms?: unknown[] };
    if (!Array.isArray(parsed.terms)) {
      throw new Error(
        `Model returned malformed term extraction (no terms array). stop_reason=${response.stop_reason}, output_tokens=${response.usage.output_tokens}`
      );
    }

    return {
      entries: parsed.terms,
      model_id: modelId,
      input_tokens: response.usage.input_tokens,
      output_tokens: response.usage.output_tokens,
      cache_read_input_tokens: response.usage.cache_read_input_tokens ?? 0,
      cache_creation_input_tokens: response.usage.cache_creation_input_tokens ?? 0,
    };
  }

  try {
    return await attempt();
  } catch (err) {
    if (err instanceof RefusalError) throw err;
    console.error("extractContractTerms: first attempt failed, retrying once —", err);
    return await attempt();
  }
}

// ---------------------------------------------------------------------------
// Historical contracts. One read per contract records its details (hotel,
// client, dates) and its terms, so an admin uploading hundreds of past
// contracts types nothing. Sent through the Batch service at half price.
// Same module as analyzeContract per the single-outbound-call-site rule.
// ---------------------------------------------------------------------------

const HISTORICAL_TOOL_NAME = "record_historical_contract";

/** A detail stated in the contract, with the words that state it. */
const statedDetail = (description: string) => ({
  type: ["object", "null"],
  description: `${description} Null when the contract doesn't state it.`,
  properties: {
    value: { type: "string" },
    quoted_text: { type: "string", description: "Words copied exactly from the contract that state this detail." },
  },
  required: ["value", "quoted_text"],
});

export const historicalToolSchema = (catalog: TermCatalog) => ({
  name: HISTORICAL_TOOL_NAME,
  description: "Record this signed contract's details and every catalog term it states, each with the wording that states it.",
  input_schema: {
    type: "object" as const,
    properties: {
      details: {
        type: "object",
        properties: {
          hotel_name: statedDetail("The hotel or venue's name as the contract gives it, such as \"Hilton Denver City Center\"."),
          brand: statedDetail("The hotel's brand, such as \"Hilton\" or \"Westin\", as the contract states it."),
          city: statedDetail("The city the hotel is in."),
          state: statedDetail("The state or province, as a two-letter code where one exists, such as \"CO\"."),
          country: statedDetail("The country the hotel is in."),
          client_name: statedDetail("The group or organization holding the event: the party contracting with the hotel, not ConferenceDirect."),
          signed_date: statedDetail("The date the contract was signed, as YYYY-MM-DD. Take the latest signature date if there are several."),
          event_start: statedDetail("The event's first date, as YYYY-MM-DD."),
          event_end: statedDetail("The event's last date, as YYYY-MM-DD."),
          negotiated_by: statedDetail("The ConferenceDirect associate named in the contract, such as in a contact or signature block. Their name only."),
          parent_company: {
            type: ["string", "null"],
            description: "The brand's parent company, such as \"Marriott International\", from what you know of the brand. Null if you don't know.",
          },
          market_tier: {
            type: ["string", "null"],
            enum: ["luxury", "upper_upscale", "upscale", "resort", "convention", null],
            description: "The hotel's market tier, judged from its brand and the contract. Null if you can't tell.",
          },
        },
        required: [
          "hotel_name",
          "brand",
          "city",
          "state",
          "country",
          "client_name",
          "signed_date",
          "event_start",
          "event_end",
          "negotiated_by",
          "parent_company",
          "market_tier",
        ],
      },
      terms: termsToolSchema(catalog).input_schema.properties.terms,
    },
    required: ["details", "terms"],
  },
});

/** The term extraction rules, with the details section ahead of them. */
export function buildHistoricalPrompt(catalog: TermCatalog) {
  const [rules, catalogBlock] = buildTermExtractionPrompt(catalog);
  const details = `This contract is already signed. Before its terms, record its details in "details".

Details:
- Record each detail from the contract's own words, with quoted_text copied exactly, the shortest span that states it. If the contract doesn't state a detail, give null. Never guess one.
- parent_company and market_tier are the exceptions. Give them from what you know of the brand, or null if you don't know. They carry no quote.
- The client is the group holding the event, never ConferenceDirect, which is the group's agent.
- Write dates as YYYY-MM-DD.

Terms:
`;
  return [{ ...rules, text: `${details}${rules.text}` }, catalogBlock];
}

/** The request for one historical contract, the same whether it goes in a batch or on its own. */
export function historicalRequest({
  document,
  catalog,
  model,
}: {
  document: AnalyzableDocument;
  catalog: TermCatalog;
  model?: string;
}): Anthropic.Messages.MessageCreateParamsNonStreaming {
  const modelId = model || process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5";
  return {
    model: modelId,
    max_tokens: 16000,
    system: withAnswerInstruction(buildHistoricalPrompt(catalog), modelId, historicalToolSchema(catalog)),
    ...answerRequest(modelId, historicalToolSchema(catalog)),
    messages: [
      {
        role: "user",
        content:
          document.kind === "pdf"
            ? [{ type: "document", source: { type: "base64", media_type: "application/pdf", data: document.pdfBase64 } }]
            : [{ type: "text", text: `CONTRACT TEXT:\n\n${document.text}` }],
      },
    ],
  };
}

export interface HistoricalReading {
  /** Unchecked. Pass through checkDetails before storing anything. */
  details: Record<string, unknown>;
  /** Unvalidated. Pass through validateTerms before storing anything. */
  entries: unknown[];
  model_id: string;
  input_tokens: number;
  output_tokens: number;
}

/** The recorded answer in one response, or why there isn't one. */
export function readHistoricalResponse(response: Anthropic.Messages.Message): HistoricalReading {
  if (response.stop_reason === "refusal") throw new Error("The model declined to read this contract.");
  if (response.stop_reason === "max_tokens") throw new Error("The reading ran past the output limit and was cut off.");
  const input = readAnswer(response, "a record of the contract") as { details?: unknown; terms?: unknown };
  if (!input.details || typeof input.details !== "object" || !Array.isArray(input.terms)) {
    throw new Error("The model's record was missing its details or terms.");
  }
  return {
    details: input.details as Record<string, unknown>,
    entries: input.terms,
    model_id: response.model,
    input_tokens: response.usage.input_tokens,
    output_tokens: response.usage.output_tokens,
  };
}

function batchClient() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set. Add it to .env.local (see .env.local.example).");
  return new Anthropic({ apiKey });
}

/**
 * A request's input tokens. The endpoint bills nothing and rejects a request
 * the model wouldn't accept, so it is also a free check of a request's shape.
 */
export async function countRequestTokens(params: Anthropic.Messages.MessageCountTokensParams): Promise<number> {
  const { input_tokens } = await batchClient().messages.countTokens(params);
  return input_tokens;
}

/**
 * Sends a request for one output token, and returns what it was billed.
 *
 * The counting endpoint doesn't compile an output format's schema, so a schema
 * too large to compile only fails here. Paid, at the request's input tokens.
 */
export async function sendOneTokenRequest(params: Omit<Anthropic.Messages.MessageCreateParamsNonStreaming, "max_tokens">) {
  const { usage } = await batchClient().messages.create({ ...params, max_tokens: 1 }, { maxRetries: 0 });
  return { input_tokens: usage.input_tokens, output_tokens: usage.output_tokens };
}

/** Sends historical contracts to the Batch service, keyed by their ids. */
export async function sendHistoricalBatch(requests: { custom_id: string; params: Anthropic.Messages.MessageCreateParamsNonStreaming }[]) {
  const batch = await batchClient().messages.batches.create({ requests });
  return batch.id;
}

export type HistoricalBatchResult =
  | { custom_id: string; ok: true; reading: HistoricalReading }
  | { custom_id: string; ok: false; error: string };

/** A batch's results once it has ended, or null while it's still running. */
export async function collectHistoricalBatch(batchId: string): Promise<HistoricalBatchResult[] | null> {
  const client = batchClient();
  const batch = await client.messages.batches.retrieve(batchId);
  if (batch.processing_status !== "ended") return null;

  const results: HistoricalBatchResult[] = [];
  for await (const item of await client.messages.batches.results(batchId)) {
    if (item.result.type !== "succeeded") {
      results.push({ custom_id: item.custom_id, ok: false, error: `The batch request ${item.result.type}.` });
      continue;
    }
    try {
      results.push({ custom_id: item.custom_id, ok: true, reading: readHistoricalResponse(item.result.message) });
    } catch (err) {
      results.push({ custom_id: item.custom_id, ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return results;
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
      system: withAnswerInstruction(buildEvalDraftPrompt(voice), modelId, DRAFT_TOOL_SCHEMA),
      ...answerRequest(modelId, DRAFT_TOOL_SCHEMA),
      messages: [{ role: "user", content: [{ type: "text", text: userText }] }],
    })
    .finalMessage();
  checkRefusal(response, "draft these clauses");

  const parsed = readAnswer(response, "drafted clauses") as { clauses?: DraftedClauseResult[] };
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
      system: withAnswerInstruction(buildEvalReadBackPrompt(), modelId, READBACK_TOOL_SCHEMA),
      ...answerRequest(modelId, READBACK_TOOL_SCHEMA),
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: `CONTRACT:\n\n${contractText}\n\nQUESTIONS:\n\n${questionBlock}` }],
        },
      ],
    })
    .finalMessage();
  checkRefusal(response, "read these terms back");

  const parsed = readAnswer(response, "a term read-back") as { answers?: ReadBackEvalTermsResult["answers"] };
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
