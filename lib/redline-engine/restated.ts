/**
 * Wording a proposal repeats from elsewhere in the contract.
 *
 * The model sometimes restates a sentence it isn't changing, from next to its
 * quote or from another clause. Inserting that sentence prints it twice once
 * the changes are accepted. It also rewrites sentences it never quoted, which
 * leaves the old and new versions side by side. A proposal that opens with a
 * long run of existing wording, and quotes nothing, is a rewrite of a clause
 * it never located.
 */

/** Words a sentence needs before its repetition counts. Short phrases recur in any contract. */
const MIN_SENTENCE_WORDS = 8;

/** Opening words that mark a quote-less proposal as a rewrite of existing wording. */
const REWRITE_OPENING_WORDS = 12;

/** Words a contract sentence needs before a rewording of it counts. */
const MIN_REWORDED_WORDS = 10;

/** Share of the contract sentence's words that must survive, in order, in the proposal sentence. */
const REWORDED_COVERAGE = 0.9;

/** Opening words a rewording can share instead of making up half the proposal sentence. */
const SHARED_OPENING_WORDS = 4;

/** A proposal sentence at least this long, nearly all taken from one contract sentence, is a shortened copy of it. */
const MIN_SHORTENED_WORDS = 12;

/** Share of the contract sentence a shortened copy must keep. */
const SHORTENED_KEEPS = 0.6;

const flat = (s: string) => s.replace(/\s+/g, " ").trim();
const wordCount = (s: string) => (s.match(/\S+/g) ?? []).length;
const words = (s: string) => s.toLowerCase().match(/[a-z0-9$%]+/g) ?? [];

function sentences(text: string): string[] {
  return text
    .split(/(?<=[.;?!]["'”’)\]]*)\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Length of the longest run of `a`'s words that appears in `b` in the same order. */
function commonSubsequence(a: string[], b: string[]): number {
  let prev = new Array<number>(b.length + 1).fill(0);
  for (const word of a) {
    const row = new Array<number>(b.length + 1).fill(0);
    for (let j = 1; j <= b.length; j++) {
      row[j] = word === b[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], row[j - 1]);
    }
    prev = row;
  }
  return prev[b.length];
}

interface ContractSentence {
  words: string[];
  vocabulary: Set<string>;
}

// Every finding in a batch reads the same contract, so its sentences are split once.
let cached: { contract: string; sentences: ContractSentence[] } | null = null;

function contractSentences(contract: string): ContractSentence[] {
  if (cached?.contract !== contract) {
    const list = contract
      .split("\n")
      .flatMap(sentences)
      .map((text) => ({ words: words(text) }))
      .filter((s) => s.words.length >= MIN_REWORDED_WORDS)
      .map((s) => ({ ...s, vocabulary: new Set(s.words) }));
    cached = { contract, sentences: list };
  }
  return cached.sentences;
}

/**
 * Whether a proposal sentence rewrites an unprotected contract sentence. Two
 * shapes count, with words compared in order:
 *
 * - it keeps nearly all the contract sentence, which makes up most of it or
 *   shares its opening (a sentence with wording added)
 * - nearly all of it comes from the contract sentence, which keeps most of
 *   its words (a sentence with wording cut, such as a figure changed and a
 *   long qualifier dropped)
 *
 * Protection is compared by words, so a bullet glyph or tab the contract
 * carries doesn't hide a sentence the finding quotes.
 */
function rewordedFrom(sentence: string, contract: string, protectedWords: string[]): boolean {
  const proposal = words(sentence);
  if (proposal.length < MIN_SENTENCE_WORDS) return false;
  const vocabulary = new Set(proposal);

  for (const candidate of contractSentences(contract)) {
    let shared = 0;
    for (const w of candidate.words) if (vocabulary.has(w)) shared++;
    if (shared < candidate.words.length * SHORTENED_KEEPS) continue;

    const common = commonSubsequence(candidate.words, proposal);
    const sameOpening =
      candidate.words.slice(0, SHARED_OPENING_WORDS).join(" ") === proposal.slice(0, SHARED_OPENING_WORDS).join(" ");
    const added =
      common >= candidate.words.length * REWORDED_COVERAGE &&
      (candidate.words.length * 2 >= proposal.length || sameOpening);
    const cut =
      proposal.length >= MIN_SHORTENED_WORDS &&
      common >= proposal.length * REWORDED_COVERAGE &&
      common >= candidate.words.length * SHORTENED_KEEPS;
    if (!added && !cut) continue;
    const joined = candidate.words.join(" ");
    if (protectedWords.some((p) => p.includes(joined))) continue;
    return true;
  }
  return false;
}

export interface Restated {
  language: string;
  /** Sentences left out because the contract already has them. */
  dropped: string[];
  /** Sentences left out because they rewrite contract wording the finding doesn't quote. */
  reworded: string[];
}

/**
 * Leaves out each proposal sentence the contract already has, word for word
 * or reworded.
 *
 * `keep` holds wording a sentence must not be dropped for: the sentences other
 * findings strike, and the span this change replaces. The contract loses
 * those, so dropping them here would lose them altogether. A rewording of any
 * other sentence is left out, because the redline can't strike wording the
 * finding never quoted, and inserting it would leave both versions. A proposal
 * made only of such sentences is left whole, because that is the model's full
 * wording.
 */
export function dropRestated(language: string, contract: string, keep: string[]): Restated {
  const text = flat(contract);
  const protectedText = keep.map(flat);
  const protectedWords = keep.map((k) => words(k).join(" "));

  const kept: string[] = [];
  const dropped: string[] = [];
  const reworded: string[] = [];
  for (const sentence of sentences(language)) {
    const s = flat(sentence);
    const isProtected = protectedText.some((p) => p.includes(s));
    if (wordCount(s) >= MIN_SENTENCE_WORDS && text.includes(s)) {
      (isProtected ? kept : dropped).push(sentence);
    } else if (!isProtected && rewordedFrom(s, contract, protectedWords)) {
      reworded.push(sentence);
    } else {
      kept.push(sentence);
    }
  }

  if (kept.length === 0 || dropped.length + reworded.length === 0) return { language, dropped: [], reworded: [] };
  return { language: kept.join(" "), dropped, reworded };
}

/** True when a proposal opens with a long run of wording the contract already has. */
export function rewritesExistingWording(language: string, contract: string): boolean {
  const opening = flat(language).split(" ").slice(0, REWRITE_OPENING_WORDS);
  return opening.length === REWRITE_OPENING_WORDS && flat(contract).includes(opening.join(" "));
}

/**
 * Sentences each finding's quote has and its proposal doesn't. These are the
 * sentences the batch strikes from the contract.
 */
export function struckSentences(findings: { quoted_text: string | null; language: string }[]): string[] {
  return findings.flatMap((f) => {
    if (!f.quoted_text) return [];
    const proposal = flat(f.language);
    return sentences(f.quoted_text).filter((s) => !proposal.includes(flat(s)));
  });
}
