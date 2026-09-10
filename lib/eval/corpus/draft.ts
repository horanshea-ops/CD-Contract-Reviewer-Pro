import { extractDocx } from "../../docx";
import type { ExtractedDocument } from "../../docx/types";
import { locateQuote } from "../../redline-engine/locate";
import { isLocated } from "../../redline-engine/types";
import type { ClauseDraftRequest, DraftedClauseResult, TermQuestion } from "../../anthropic";
import type { draftEvalClauses, readBackEvalTerms } from "../../anthropic";
import type { AnchorSpan } from "../types";
import type { ClauseTerms, EvalContractSpec } from "./spec";
import { POSITION_BY_CLAUSE } from "./positions";
import { buildDirectives, requiredWording, meaningNote, BOOLEAN_MEANING, ENUM_WORDING } from "./directives";
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
const MAX_ATTEMPTS = 4;

export interface ResolvedAnchor {
  clause_type: string;
  field: string;
  text: string;
  span: AnchorSpan;
}

export interface DraftDeps {
  draftClauses: typeof draftEvalClauses;
  /**
   * Reads the finished contract back and checks it means what the spec says.
   *
   * Not optional. A model writes the prose, so it can drift from the spec it
   * was given, and the boolean terms have no literal handle to check against —
   * only meaning, which has to be read.
   */
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

/** Case, punctuation and spacing set aside, for comparing a sentence to a note. */
const flatten = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/**
 * Retries a call that failed for a reason unrelated to what it asked for.
 *
 * A dropped stream or a rate limit says nothing about the draft, and letting it
 * end a seven-contract build wastes every contract already paid for. Gate
 * failures are handled separately and are not retried here — those mean the
 * draft was wrong, not that the call was.
 */
async function withRetry<T>(what: string, attempt: () => Promise<T>): Promise<T> {
  let last: unknown;
  for (let tries = 1; tries <= 3; tries++) {
    try {
      return await attempt();
    } catch (err) {
      last = err;
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`  ${what} failed (attempt ${tries}/3): ${message}`);
      // Backs off far enough to clear a rate limit. Retrying two seconds after
      // being throttled just gets throttled again.
      if (tries < 3) await new Promise((resolve) => setTimeout(resolve, 15_000 * tries));
    }
  }
  throw last;
}

function draftRequests(spec: EvalContractSpec, clauseTypes: string[]): ClauseDraftRequest[] {
  return clauseTypes.map((clauseType) => ({
    clause_type: clauseType,
    section_title: SECTION_TITLE[clauseType],
    fields: buildDirectives(clauseType, terms(spec, clauseType)),
  }));
}

/**
 * Relabels a clause the model returned under its section title.
 *
 * The request names each clause twice, once by identifier and once by the
 * section title in quotes, and the model sometimes answers with the title.
 * Nothing about the prose is wrong when that happens, so rejecting the batch
 * would spend three more drafting calls to fix a label. Titles are unique
 * across the corpus, so mapping one back is unambiguous — and a label that
 * matches neither still falls through to "not returned".
 */
export function normalizeClauseTypes(
  requests: ClauseDraftRequest[],
  drafted: DraftedClauseResult[]
): DraftedClauseResult[] {
  const byTitle = new Map(requests.map((r) => [r.section_title.toLowerCase(), r.clause_type]));
  const known = new Set(requests.map((r) => r.clause_type));

  return drafted.map((clause) => {
    if (known.has(clause.clause_type)) return clause;
    const fromTitle = byTitle.get(clause.clause_type.trim().toLowerCase());
    return fromTitle ? { ...clause, clause_type: fromTitle } : clause;
  });
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
      // Whitespace collapsed on both sides. A model reflows its own sentence
      // when copying it back, and locateQuote matches that at the normalized
      // tier regardless — so rejecting it here would re-draft the clause to fix
      // a line break.
      if (!flatten(prose).includes(flatten(sentence))) {
        failures.push(`${request.clause_type}.${field.field}: anchor sentence is not a substring of the prose`);
        continue;
      }
      const clauseTerms = terms(spec, request.clause_type);

      const wording = requiredWording(request.clause_type, field.field, clauseTerms);
      if (wording && !flatten(sentence).includes(flatten(wording))) {
        failures.push(
          `${request.clause_type}.${field.field}: anchor sentence omits the dictated wording "${wording}"`
        );
      }

      const note = meaningNote(request.clause_type, field.field, clauseTerms);
      if (note && flatten(sentence) === flatten(note)) {
        failures.push(
          `${request.clause_type}.${field.field}: anchor sentence copies the plain-English note instead of rewriting it as contract language`
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
          // A choice between two concrete statements, not a verdict on one.
          // "True or false: deposits are refunded" asks the reader to judge a
          // proposition, and a clause that is silent on the exact wording of
          // the proposition gets judged on what contracts usually say. Offering
          // both polarities asks only which one is written down.
          question: `Which of these does the agreement provide? (a) ${meaning.true} (b) ${meaning.false}`,
          // A drafted clause states every field, so "unstated" is always a
          // failure here rather than a third valid answer.
          options: ["a", "b", "unstated"],
          expected: clause[check.field] === true ? "a" : "b",
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
    // Failures quote the wording. "Does not resolve" with nothing to look at
    // says only that something is wrong, and the difference is usually a single
    // character.
    const quoted = `\n      wanted: ${JSON.stringify(item.text.slice(0, 160))}`;

    if (!isLocated(located)) {
      failures.push(
        `${item.clause_type}.${item.field}: anchor does not resolve in the built document — ${located.reason}${quoted}`
      );
      continue;
    }
    // A fuzzy hit means the text in the document is not the text the key
    // carries. Close enough to redline is not close enough to be ground truth.
    if (located.resolution === "fuzzy") {
      const found = textByPart.get(located.part)!.slice(located.start, located.end);
      failures.push(
        `${item.clause_type}.${item.field}: anchor resolves only fuzzily, so the key would not point at exact wording` +
          `${quoted}\n      found : ${JSON.stringify(found.slice(0, 160))}`
      );
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

  // Overlap only matters ACROSS clauses. Every anchor of one clause attaches to
  // that clause's single key item, so one sentence stating two of its terms —
  // "liable for seventy percent (70%) of the rate below ninety percent (90%)
  // pickup" — is ordinary contract prose and points at the same issue either
  // way. A span shared by two DIFFERENT clauses is the real problem: a finding
  // quoting it cannot be attributed, and the scorer would pick one silently.
  const deduped: ResolvedAnchor[] = [];
  for (const anchor of anchors) {
    const already = deduped.some(
      (k) =>
        k.clause_type === anchor.clause_type &&
        k.span.part === anchor.span.part &&
        k.span.start === anchor.span.start &&
        k.span.end === anchor.span.end
    );
    if (!already) deduped.push(anchor);
  }

  for (let i = 0; i < deduped.length; i++) {
    for (let j = i + 1; j < deduped.length; j++) {
      const a = deduped[i];
      const b = deduped[j];
      if (a.clause_type === b.clause_type) continue;
      if (a.span.part !== b.span.part) continue;
      if (a.span.start < b.span.end && b.span.start < a.span.end) {
        failures.push(
          `${a.clause_type}.${a.field} and ${b.clause_type}.${b.field}: anchors overlap in ${a.span.part}, so a finding quoting that wording could belong to either clause`
        );
      }
    }
  }

  return { anchors: deduped, failures };
}

/** The clause a gate failure names, so a retry can be aimed at it. */
const clauseOf = (failure: string) => failure.match(/^([a-z_]+)[.#]/)?.[1] ?? null;

/**
 * Drafts the named clauses into `drafted`, retrying a clause that fails the
 * mechanical checks rather than the batch it arrived in.
 *
 * A batch retry rerolls clauses that were fine to fix one that was not, and
 * each reroll is a fresh chance for a different clause to drift.
 */
async function draftInto(
  spec: EvalContractSpec,
  clauseTypes: string[],
  drafted: Map<string, DraftedClause>,
  deps: DraftDeps,
  tokens: { input: number; output: number },
  retries: string[]
): Promise<void> {
  for (let i = 0; i < clauseTypes.length; i += BATCH_SIZE) {
    let pending = draftRequests(spec, clauseTypes.slice(i, i + BATCH_SIZE));
    let lastFailures: string[] = [];

    for (let attempt = 1; attempt <= MAX_ATTEMPTS && pending.length > 0; attempt++) {
      const result = await withRetry("drafting", () =>
        deps.draftClauses({
          hotel: spec.hotel,
          group: spec.group,
          city: spec.city,
          state: spec.state,
          dates: spec.dates,
          voice: spec.style.voice,
          clauses: pending,
        })
      );
      tokens.input += result.input_tokens;
      tokens.output += result.output_tokens;

      const clauses = normalizeClauseTypes(pending, result.clauses);
      const byClause = new Map(clauses.map((c) => [c.clause_type, c]));

      const stillPending: ClauseDraftRequest[] = [];
      lastFailures = [];

      for (const request of pending) {
        const clause = byClause.get(request.clause_type);
        const failures = checkDraftBatch(spec, [request], clause ? [clause] : []);
        if (failures.length === 0 && clause) {
          drafted.set(clause.clause_type, {
            clause_type: clause.clause_type,
            paragraphs: clause.paragraphs,
            anchors: clause.anchors,
          });
          continue;
        }
        stillPending.push(request);
        lastFailures.push(...failures);
      }

      if (stillPending.length) retries.push(`draft attempt ${attempt}: ${lastFailures.join("; ")}`);
      pending = stillPending;
    }

    if (pending.length) throw new CorpusIntegrityError(spec.id, lastFailures);
  }
}

export interface BuildContractOptions {
  /**
   * Clauses drafted by an earlier run that already passed the gate.
   *
   * Supplying them skips drafting and skips the read-back, and the contract is
   * only reassembled so its anchors can be located again. That is what makes a
   * failed build cheap to resume: one contract failing at the end of seven
   * should not mean paying to redraft the six that succeeded.
   */
  reuse?: DraftedClause[];
}

export async function buildContract(
  spec: EvalContractSpec,
  deps: DraftDeps,
  options: BuildContractOptions = {}
): Promise<BuildContractResult> {
  const clauseTypes = clausesToDraft(spec);
  const tokens = { input: 0, output: 0 };
  const retries: string[] = [];
  const drafted = new Map<string, DraftedClause>();

  if (options.reuse) {
    for (const clause of options.reuse) drafted.set(clause.clause_type, clause);

    const missing = clauseTypes.filter((c) => !drafted.has(c));
    if (missing.length) {
      throw new CorpusIntegrityError(spec.id, [
        `reused draft is missing clause(s) ${missing.join(", ")} — the spec changed since it was written, so redraft it`,
      ]);
    }

    const ordered = clauseTypes.map((c) => drafted.get(c)!);
    const { document, anchors: placed } = layOutContract(spec, ordered);
    const bytes = await buildContractDocx(document);
    const extracted = await extractDocx(bytes);
    const { anchors, failures } = resolveAnchors(extracted, placed);
    if (failures.length) throw new CorpusIntegrityError(spec.id, failures);

    return { spec, bytes, extracted, anchors, drafted: ordered, attempts: 0, tokens, retries };
  }

  await draftInto(spec, clauseTypes, drafted, deps, tokens, retries);

  /**
   * Assemble, then check what came out, then fix what did not survive.
   *
   * Both remaining checks run on the FINISHED document rather than on the
   * draft, so neither can be folded into the drafting loop above. A failure in
   * either re-drafts the clause it names and assembles again — without that,
   * one clause out of roughly fifty read back wrong would throw the whole
   * contract away, and at that rate almost every contract fails.
   */
  for (let round = 1; round <= MAX_ATTEMPTS; round++) {
    const ordered = clauseTypes.map((c) => drafted.get(c)!).filter(Boolean);
    const { document, anchors: placed } = layOutContract(spec, ordered);
    const bytes = await buildContractDocx(document);
    const extracted = await extractDocx(bytes);

    const { anchors, failures } = resolveAnchors(extracted, placed);
    if (failures.length) {
      if (round === MAX_ATTEMPTS) throw new CorpusIntegrityError(spec.id, failures);
      retries.push(`round ${round} anchors: ${failures.join("; ")}`);
      await draftInto(spec, unique(failures.map(clauseOf)), drafted, deps, tokens, retries);
      continue;
    }

    const questions = readBackQuestions(spec);
    const readBack = await withRetry("read-back", () =>
      deps.readBack({
        contractText: extracted.parts.map((p) => p.text).join("\n\n"),
        questions: questions.map(({ id, question, options }) => ({ id, question, options })),
      })
    );
    tokens.input += readBack.input_tokens;
    tokens.output += readBack.output_tokens;

    const answered = new Map(readBack.answers.map((a) => [a.id, a.answer]));
    const disagreements = questions
      .filter((q) => answered.get(q.id) !== q.expected)
      .map((q) => `${q.id}: spec says "${q.expected}", the contract reads as "${answered.get(q.id) ?? "no answer"}"`);

    if (disagreements.length === 0) {
      return { spec, bytes, extracted, anchors, drafted: ordered, attempts: round, tokens, retries };
    }
    if (round === MAX_ATTEMPTS) throw new CorpusIntegrityError(spec.id, disagreements);
    retries.push(`round ${round} read-back: ${disagreements.join("; ")}`);

    // A question about an absent clause has no clause to re-draft — the reader
    // found the topic somewhere in another clause's prose, and which one is not
    // recoverable from the answer. Re-draft everything in that case.
    const aboutAbsent = disagreements.some((d) => d.includes("#present"));
    const target = aboutAbsent ? clauseTypes : unique(disagreements.map(clauseOf));
    await draftInto(spec, target, drafted, deps, tokens, retries);
  }

  throw new CorpusIntegrityError(spec.id, ["the document never settled within the allowed rounds"]);
}

const unique = (values: Array<string | null>): string[] => [...new Set(values.filter((v): v is string => v !== null))];
