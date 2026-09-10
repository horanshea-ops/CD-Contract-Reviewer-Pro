import type { LocatablePart } from "../redline-engine/locate";
import type { Severity } from "../standards/types";
import { matchDocument, normalizeClauseType } from "./match";
import { gradePair, languageWasGraded } from "./grade";
import { SEVERITY_ORDER, SEVERITY_WEIGHT } from "./types";
import type {
  AnswerKey,
  AttributeRates,
  ClauseTypeRow,
  ContractResult,
  DetectionRates,
  ExposureVerdict,
  KeyItem,
  MatchedPair,
  MissedItem,
  QuoteVerdict,
  RunRecord,
  ScoreReport,
  SeverityBandRow,
  UnmatchedFinding,
} from "./types";

/**
 * Scoring a whole run against an answer key (MASTER_PLAN.md §2.0.1).
 *
 * Deterministic and offline. Everything that needed a model — producing the
 * findings — already happened; this reads the run record and the key and does
 * arithmetic, so the same run scored twice gives the same report.
 *
 * The report carries the individual pairings as well as the rates. A rate
 * nobody can check against the pairings behind it is exactly the failure this
 * section exists to prevent, so the audit trail is part of the output rather
 * than a debugging aid.
 */

export interface ScoreRunArgs {
  key: AnswerKey;
  run: RunRecord;
  /** Extracted parts per contract file name. Re-extracted at score time, never stored in the run. */
  documents: Map<string, LocatablePart[]>;
}

const zeroTokens = () => ({ input: 0, output: 0, cache_read: 0, cache_creation: 0 });

function emptySeverityMatrix(): Record<Severity, Record<Severity, number>> {
  const row = () => Object.fromEntries(SEVERITY_ORDER.map((s) => [s, 0])) as Record<Severity, number>;
  return Object.fromEntries(SEVERITY_ORDER.map((s) => [s, row()])) as Record<Severity, Record<Severity, number>>;
}

const ratio = (numerator: number, denominator: number) => (denominator === 0 ? 0 : numerator / denominator);

/** Everything the key expects to have been considered for a contract. */
const expectedClauseTypes = (items: KeyItem[], allClauseTypes: string[]) =>
  allClauseTypes.length > 0 ? allClauseTypes : [...new Set(items.map((i) => i.clause_type))];

function scoreContract(
  entry: AnswerKey["contracts"][number],
  run: RunRecord,
  documents: Map<string, LocatablePart[]>,
  allClauseTypes: string[]
): ContractResult {
  const document = run.documents.find((d) => d.contract === entry.contract);
  const expected = expectedClauseTypes(entry.items, allClauseTypes);

  // A contract the run never analysed, or that failed. Every key item counts as
  // missed — not as unscored — because a pipeline that cannot read a document
  // finds nothing in it, and that is a result, not an absence of one.
  if (!document || !document.analysis) {
    return {
      contract: entry.contract,
      exhaustive: entry.exhaustive,
      error: document?.error ?? "the run contains no analysis for this contract",
      matched: [],
      missed: entry.items.map((item) => ({
        key_item_id: item.id,
        clause_type: item.clause_type,
        severity: item.severity,
        kind: item.kind,
        anchor_texts: item.anchor_texts,
        conflated_with: null,
      })),
      unmatched: [],
      coverage: { expected, not_checked: expected },
      tokens: zeroTokens(),
      elapsed_ms: document?.elapsed_ms ?? 0,
    };
  }

  const analysis = document.analysis;
  const parts = documents.get(entry.contract);
  if (!parts) {
    throw new Error(
      `No extracted text supplied for "${entry.contract}". Scoring re-extracts the DOCX rather than trusting text stored in the run.`
    );
  }

  const { pairs, locations, unmatchedKey, unmatchedFindings } = matchDocument(entry.items, analysis.findings, parts);

  const matched: MatchedPair[] = pairs.map((pair) => {
    const item = entry.items[pair.keyIndex];
    const finding = analysis.findings[pair.findingIndex];
    return {
      key_item_id: item.id,
      finding_index: pair.findingIndex,
      basis: pair.basis,
      weight: pair.weight,
      overlap_fraction: pair.overlap,
      key_clause_type: item.clause_type,
      key_severity: item.severity,
      key_anchor_texts: item.anchor_texts,
      finding_clause_type: finding.clause_type,
      finding_severity: finding.severity,
      finding_quoted_text: finding.quoted_text,
      location: locations[pair.findingIndex],
      grade: gradePair(item, finding, locations[pair.findingIndex]),
    };
  });

  const missed: MissedItem[] = unmatchedKey.map(({ keyIndex, conflatedWith }) => {
    const item = entry.items[keyIndex];
    return {
      key_item_id: item.id,
      clause_type: item.clause_type,
      severity: item.severity,
      kind: item.kind,
      anchor_texts: item.anchor_texts,
      conflated_with: conflatedWith,
    };
  });

  const unmatched: UnmatchedFinding[] = unmatchedFindings.map(({ findingIndex, duplicateOf }) => {
    const finding = analysis.findings[findingIndex];
    return {
      finding_index: findingIndex,
      // A finding matching nothing is only wrong if the key claims to list
      // everything. Against a reviewer's key, which was never asked to be
      // exhaustive, it is unjudged.
      outcome: duplicateOf !== null ? "duplicate" : entry.exhaustive ? "spurious" : "unscored",
      clause_type: finding.clause_type,
      severity: finding.severity,
      quoted_text: finding.quoted_text,
      location: locations[findingIndex],
      duplicate_of: duplicateOf === null ? null : entry.items[duplicateOf].id,
    };
  });

  const checked = new Set(analysis.clauses_checked.map(normalizeClauseType));

  return {
    contract: entry.contract,
    exhaustive: entry.exhaustive,
    error: null,
    matched,
    missed,
    unmatched,
    coverage: { expected, not_checked: expected.filter((c) => !checked.has(normalizeClauseType(c))) },
    tokens: {
      input: analysis.input_tokens,
      output: analysis.output_tokens,
      cache_read: analysis.cache_read_input_tokens,
      cache_creation: analysis.cache_creation_input_tokens,
    },
    elapsed_ms: document.elapsed_ms,
  };
}

function detectionOf(contracts: ContractResult[], keyItemCount: number): DetectionRates {
  const matched = contracts.reduce((n, c) => n + c.matched.length, 0);
  const conflated = contracts.reduce((n, c) => n + c.missed.filter((m) => m.conflated_with !== null).length, 0);
  const missed = contracts.reduce((n, c) => n + c.missed.length, 0) - conflated;

  const count = (outcome: UnmatchedFinding["outcome"]) =>
    contracts.reduce((n, c) => n + c.unmatched.filter((u) => u.outcome === outcome).length, 0);

  const duplicates = count("duplicate");
  const spurious = count("spurious");
  const unscored = count("unscored");

  const recall = ratio(matched, keyItemCount);
  // Unscored findings are left out of precision entirely — counting them would
  // punish a model for findings a non-exhaustive key never judged.
  const precision = ratio(matched, matched + duplicates + spurious);

  return {
    key_items: keyItemCount,
    matched,
    missed,
    conflated,
    duplicates,
    spurious,
    unscored,
    recall,
    precision,
    f1: recall + precision === 0 ? 0 : (2 * recall * precision) / (recall + precision),
  };
}

function attributesOf(contracts: ContractResult[], key: AnswerKey): AttributeRates {
  const itemsById = new Map(key.contracts.flatMap((c) => c.items).map((i) => [i.id, i]));
  const pairs = contracts.flatMap((c) => c.matched);

  const quote = Object.fromEntries(
    (["exact", "normalized", "fuzzy", "unlocatable", "ambiguous", "none"] as QuoteVerdict[]).map((v) => [v, 0])
  ) as Record<QuoteVerdict, number>;
  const exposure = Object.fromEntries(
    (["correct", "omitted", "invented", "out_of_tolerance", "not_applicable"] as ExposureVerdict[]).map((v) => [v, 0])
  ) as Record<ExposureVerdict, number>;
  const severity_confusion = emptySeverityMatrix();

  let clause_type_correct = 0;
  let presence_correct = 0;
  let severity_exact = 0;
  let severity_within_one = 0;
  let severity_over_called = 0;
  let severity_under_called = 0;
  let language_graded = 0;
  let language_passed = 0;

  for (const pair of pairs) {
    const grade = pair.grade;
    if (grade.clause_type === "correct") clause_type_correct += 1;
    if (grade.presence === "correct") presence_correct += 1;
    if (grade.severity.verdict === "exact") severity_exact += 1;
    if (Math.abs(grade.severity.distance) <= 1) severity_within_one += 1;
    if (grade.severity.verdict === "over_called") severity_over_called += 1;
    if (grade.severity.verdict === "under_called") severity_under_called += 1;

    quote[grade.quote] += 1;
    exposure[grade.exposure] += 1;
    severity_confusion[pair.key_severity][pair.finding_severity] += 1;

    const item = itemsById.get(pair.key_item_id);
    if (item && languageWasGraded(item)) {
      language_graded += 1;
      if (grade.language.passed) language_passed += 1;
    }
  }

  return {
    graded: pairs.length,
    clause_type_correct,
    presence_correct,
    severity_exact,
    severity_within_one,
    severity_over_called,
    severity_under_called,
    language_graded,
    language_passed,
    quote,
    exposure,
    severity_confusion,
  };
}

function bySeverityOf(key: AnswerKey, contracts: ContractResult[]): SeverityBandRow[] {
  const matchedIds = new Set(contracts.flatMap((c) => c.matched.map((m) => m.key_item_id)));
  const items = key.contracts.flatMap((c) => c.items);

  return SEVERITY_ORDER.map((severity) => {
    const band = items.filter((i) => i.severity === severity);
    const matched = band.filter((i) => matchedIds.has(i.id)).length;
    return { severity, key_items: band.length, matched, recall: ratio(matched, band.length) };
  }).filter((row) => row.key_items > 0);
}

function byClauseTypeOf(key: AnswerKey, contracts: ContractResult[]): ClauseTypeRow[] {
  const matchedById = new Map(contracts.flatMap((c) => c.matched).map((m) => [m.key_item_id, m]));
  const items = key.contracts.flatMap((c) => c.items);
  const spurious = contracts.flatMap((c) => c.unmatched).filter((u) => u.outcome === "spurious");

  const clauseTypes = [
    ...new Set([...items.map((i) => i.clause_type), ...spurious.map((u) => normalizeClauseType(u.clause_type))]),
  ].sort();

  return clauseTypes.map((clause_type) => {
    const mine = items.filter((i) => i.clause_type === clause_type);
    const paired = mine.map((i) => matchedById.get(i.id)).filter((m) => m !== undefined);
    const namedRight = paired.filter((m) => m.grade.clause_type === "correct").length;

    return {
      clause_type,
      key_items: mine.length,
      matched: paired.length,
      missed: mine.length - paired.length,
      spurious: spurious.filter((u) => normalizeClauseType(u.clause_type) === clause_type).length,
      recall: ratio(paired.length, mine.length),
      clause_type_accuracy: ratio(namedRight, paired.length),
    };
  });
}

export function scoreRun({ key, run, documents }: ScoreRunArgs): ScoreReport {
  const allClauseTypes = [...new Set(key.contracts.flatMap((c) => c.items.map((i) => i.clause_type)))].sort();
  const contracts = key.contracts.map((entry) => scoreContract(entry, run, documents, allClauseTypes));

  const items = key.contracts.flatMap((c) => c.items);
  const matchedIds = new Set(contracts.flatMap((c) => c.matched.map((m) => m.key_item_id)));

  const weightTotal = items.reduce((n, i) => n + SEVERITY_WEIGHT[i.severity], 0);
  const weightFound = items
    .filter((i) => matchedIds.has(i.id))
    .reduce((n, i) => n + SEVERITY_WEIGHT[i.severity], 0);

  const tokens = contracts.reduce(
    (acc, c) => ({
      input: acc.input + c.tokens.input,
      output: acc.output + c.tokens.output,
      cache_read: acc.cache_read + c.tokens.cache_read,
      cache_creation: acc.cache_creation + c.tokens.cache_creation,
    }),
    zeroTokens()
  );

  return {
    key_version: key.version,
    key_source: key.source,
    run_id: run.run_id,
    run_created_at: run.created_at,
    model_id: run.model_id,
    standards_version: run.standards_version,
    // The key encodes CD's positions as of one library version. Scoring a run
    // taken against a different one compares the model to expectations it was
    // never given, so the mismatch is stated rather than left to be noticed.
    standards_mismatch:
      key.standards_version === run.standards_version
        ? null
        : `the key was derived against ${key.standards_version} and the run used ${run.standards_version}`,
    scored_at: new Date().toISOString(),
    detection: detectionOf(contracts, items.length),
    by_severity: bySeverityOf(key, contracts),
    weighted_recall: ratio(weightFound, weightTotal),
    attributes: attributesOf(contracts, key),
    by_clause_type: byClauseTypeOf(key, contracts),
    contracts,
    tokens,
  };
}
