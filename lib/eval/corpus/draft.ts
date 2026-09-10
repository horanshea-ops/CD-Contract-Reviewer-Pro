import { extractDocx } from "../../docx";
import type { ExtractedDocument } from "../../docx/types";
import { locateQuote } from "../../redline-engine/locate";
import { isLocated } from "../../redline-engine/types";
import type { ClauseDraftRequest, DraftedClauseResult, TermQuestion } from "../../anthropic";
import type { draftEvalClauses, readBackEvalTerms } from "../../anthropic";
import type { AnchorSpan } from "../types";
import type { ClauseTerms, EvalContractSpec } from "./spec";
import { POSITION_BY_CLAUSE } from "./positions";
import { buildDirectives, requiredWording, BOOLEAN_MEANING, ENUM_WORDING } from "./directives";
import { clausesToDraft, layOutContract, SECTION_TITLE, type DraftedClause } from "./layout";
import { buildContractDocx } from "./docx-builder";

/**
 * Building one eval contract, and refusing to accept it unless it says what its
 * spec says (MASTER_PLAN.md §2.0.1).
 *
 * The gate is the point of this module. A generated contract whose prose
 * drifted from its spec produces an answer key that is confidently wrong, and a
 * wrong key is worse than no key — it reports a correct review as inaccurate
 * and there is no downstream symptom that would ever catch it.
 *
 * Five checks are mechanical and one is not. The mechanical ones cover
 * everything with a literal handle: the sentence is really in the prose, the
 * dictated figure is really in the sentence, the sentence resolves to one place
 * in the built document, and no two anchors overlap. The sixth reads the
 * finished contract back with a second, stronger model and asks what each term
 * says, because a clause that grants an obligation or denies it has no literal
 * handle to check — only meaning, and meaning has to be read.
 */

const BATCH_SIZE = 6;
const MAX_ATTEMPTS = 3;

export interface ResolvedAnchor {
  clause_type: string;
  field: string;
  text: string;
  span: AnchorSpan;
}

export interface DraftDeps {
  draftClauses: typeof draftEvalClauses;
  readBack: typeof readBackEvalTerms;
}

export interface BuildContractResult {
  spec: EvalContractSpec;
  bytes: Uint8Array;
  extracted: ExtractedDocument;
  anchors: ResolvedAnchor[];
  drafted: DraftedClause[];
  attempts: number;
  tokens: { input: number; output: number };
  /** Gate failures that were retried past, kept so a weak contract is visible. */
  retries: string[];
}

export class CorpusIntegrityError extends Error {
  constructor(
    readonly contract: string,
    readonly failures: string[]
  ) {
    super(`Corpus integrity gate failed for ${contract}:\n  - ${failures.join("\n  - ")}`);
    this.name = "CorpusIntegrityError";
  }
}

const terms = (spec: EvalContractSpec, clauseType: string): ClauseTerms => {
  const clause = spec.terms[clauseType];
  if (clause === "absent") throw new Error(`${spec.id}: ${clauseType} is absent and has no terms.`);
  return clause;
};

function draftRequests(spec: EvalContractSpec, clauseTypes: string[]): ClauseDraftRequest[] {
  return clauseTypes.map((clauseType) => ({
    clause_type: clauseType,
    section_title: SECTION_TITLE[clauseType],
    fields: buildDirectives(clauseType, terms(spec, clauseType)),
  }));
}

/**
 * Checks a batch of drafted clauses against what was asked for, with no model
 * involved. Returns the problems; an empty list means the batch is usable.
 */
export function checkDraftBatch(
  spec: EvalContractSpec,
  requests: ClauseDraftRequest[],
  drafted: DraftedClauseResult[]
): string[] {
  const failures: string[] = [];
  const byClause = new Map(drafted.map((d) => [d.clause_type, d]));

  for (const request of requests) {
    const clause = byClause.get(request.clause_type);
    if (!clause) {
      failures.push(`${request.clause_type}: not returned`);
      continue;
    }

    const prose = clause.paragraphs.join("\n");
    if (prose.trim().length === 0) {
      failures.push(`${request.clause_type}: empty prose`);
      continue;
    }
    if (/^\s*(#|\*|-|\d+\.)\s/m.test(prose)) {
      failures.push(`${request.clause_type}: prose contains a heading, bullet or list marker`);
    }

    const anchorByField = new Map(clause.anchors.map((a) => [a.field, a.sentence]));
    for (const field of request.fields) {
      const sentence = anchorByField.get(field.field);
      if (!sentence) {
        failures.push(`${request.clause_type}.${field.field}: no anchor sentence returned`);
        continue;
      }
      if (!prose.includes(sentence)) {
        failures.push(`${request.clause_type}.${field.field}: anchor sentence is not a verbatim substring of the prose`);
        continue;
      }
      const wording = requiredWording(request.clause_type, field.field, terms(spec, request.clause_type));
      if (wording && !sentence.includes(wording)) {
        failures.push(
          `${request.clause_type}.${field.field}: anchor sentence omits the dictated wording "${wording}"`
        );
      }
    }
  }

  return failures;
}

/** Questions that check what the built contract means, where no literal check can. */
export function readBackQuestions(spec: EvalContractSpec): Array<TermQuestion & { expected: string }> {
  const questions: Array<TermQuestion & { expected: string }> = [];

  for (const [clauseType, clause] of Object.entries(spec.terms)) {
    const position = POSITION_BY_CLAUSE.get(clauseType);
    if (!position) continue;

    if (clause === "absent") {
      questions.push({
        id: `${clauseType}#present`,
        question: `Does this agreement contain any provision addressing ${SECTION_TITLE[clauseType].toLowerCase()}?`,
        options: ["yes", "no"],
        expected: "no",
      });
      continue;
    }

    for (const check of position.checks) {
      const key = `${clauseType}.${check.field}`;

      if (check.kind === "boolean") {
        const meaning = BOOLEAN_MEANING[key];
        if (!meaning) continue;
        questions.push({
          id: key,
          question: `True or false, according to this agreement: ${meaning.true}`,
          // A drafted clause states every field, so "unstated" is always a
          // failure here rather than a third valid answer.
          options: ["yes", "no", "unstated"],
          expected: clause[check.field] === true ? "yes" : "no",
        });
        continue;
      }

      if (check.kind === "enum" && ENUM_WORDING[key]) {
        const options = Object.keys(ENUM_WORDING[key]);
        questions.push({
          id: key,
          question: `Which of these does the agreement provide for ${check.label}?`,
          options: [...options, "unstated"],
          expected: String(clause[check.field]),
        });
      }
    }
  }

  return questions;
}

/** Locates every placed anchor in the built document, and rejects any that will not resolve. */
function resolveAnchors(
  extracted: ExtractedDocument,
  placed: Array<{ clause_type: string; field: string; part: string; text: string }>
): { anchors: ResolvedAnchor[]; failures: string[] } {
  const parts = extracted.parts.map((p) => ({ part: p.part, text: p.text }));
  const textByPart = new Map(parts.map((p) => [p.part, p.text]));
  const anchors: ResolvedAnchor[] = [];
  const failures: string[] = [];

  for (const item of placed) {
    const located = locateQuote(parts, item.text, null);
    if (!isLocated(located)) {
      failures.push(`${item.clause_type}.${item.field}: anchor does not resolve in the built document — ${located.reason}`);
      continue;
    }
    // A fuzzy hit means the text in the document is not the text the key
    // carries. Close enough to redline is not close enough to be ground truth.
    if (located.resolution === "fuzzy") {
      failures.push(`${item.clause_type}.${item.field}: anchor resolves only fuzzily, so the key would not point at exact wording`);
      continue;
    }
    anchors.push({
      clause_type: item.clause_type,
      field: item.field,
      // Sliced from the document, not copied from what layout asked for. The
      // extractor renders a table row as "cell  | cell", which the normalized
      // tier still matches — so an anchor built from the request would carry
      // text that is not verbatim in the document it points at.
      text: textByPart.get(located.part)!.slice(located.start, located.end),
      span: { part: located.part, start: located.start, end: located.end },
    });
  }

  // Two anchors over the same characters make the pairing between key items and
  // findings ambiguous in a way the scorer cannot resolve and would not report.
  for (let i = 0; i < anchors.length; i++) {
    for (let j = i + 1; j < anchors.length; j++) {
      const a = anchors[i];
      const b = anchors[j];
      if (a.span.part !== b.span.part) continue;
      if (a.span.start < b.span.end && b.span.start < a.span.end) {
        failures.push(
          `${a.clause_type}.${a.field} and ${b.clause_type}.${b.field}: anchors overlap in ${a.span.part}`
        );
      }
    }
  }

  return { anchors, failures };
}

export async function buildContract(spec: EvalContractSpec, deps: DraftDeps): Promise<BuildContractResult> {
  const clauseTypes = clausesToDraft(spec);
  const batches: string[][] = [];
  for (let i = 0; i < clauseTypes.length; i += BATCH_SIZE) {
    batches.push(clauseTypes.slice(i, i + BATCH_SIZE));
  }

  const tokens = { input: 0, output: 0 };
  const retries: string[] = [];
  const drafted = new Map<string, DraftedClause>();

  // Pass one: draft each batch until it survives the mechanical checks.
  for (const batch of batches) {
    const requests = draftRequests(spec, batch);
    let lastFailures: string[] = [];

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const result = await deps.draftClauses({
        hotel: spec.hotel,
        group: spec.group,
        city: spec.city,
        state: spec.state,
        dates: spec.dates,
        voice: spec.style.voice,
        clauses: requests,
      });
      tokens.input += result.input_tokens;
      tokens.output += result.output_tokens;

      lastFailures = checkDraftBatch(spec, requests, result.clauses);
      if (lastFailures.length === 0) {
        for (const clause of result.clauses) {
          drafted.set(clause.clause_type, {
            clause_type: clause.clause_type,
            paragraphs: clause.paragraphs,
            anchors: clause.anchors,
          });
        }
        break;
      }
      retries.push(`attempt ${attempt} for [${batch.join(", ")}]: ${lastFailures.join("; ")}`);
      if (attempt === MAX_ATTEMPTS) throw new CorpusIntegrityError(spec.id, lastFailures);
    }
  }

  // Pass two: lay out, build, extract, and check the anchors survived the trip
  // through OOXML and back.
  const ordered = clauseTypes.map((c) => drafted.get(c)!).filter(Boolean);
  const { document, anchors: placed } = layOutContract(spec, ordered);
  const bytes = await buildContractDocx(document);
  const extracted = await extractDocx(bytes);

  const { anchors, failures } = resolveAnchors(extracted, placed);
  if (failures.length) throw new CorpusIntegrityError(spec.id, failures);

  // Pass three: read the finished contract back and check it means what the
  // spec says. This is the only check that covers the boolean terms, whose
  // wording the drafter chose.
  const questions = readBackQuestions(spec);
  const readBack = await deps.readBack({
    contractText: extracted.parts.map((p) => p.text).join("\n\n"),
    questions: questions.map(({ id, question, options }) => ({ id, question, options })),
  });
  tokens.input += readBack.input_tokens;
  tokens.output += readBack.output_tokens;

  const answered = new Map(readBack.answers.map((a) => [a.id, a.answer]));
  const disagreements = questions
    .filter((q) => answered.get(q.id) !== q.expected)
    .map((q) => `${q.id}: spec says "${q.expected}", the contract reads as "${answered.get(q.id) ?? "no answer"}"`);

  if (disagreements.length) throw new CorpusIntegrityError(spec.id, disagreements);

  return { spec, bytes, extracted, anchors, drafted: ordered, attempts: 1, tokens, retries };
}
