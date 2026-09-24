/**
 * Wording a proposal repeats from elsewhere in the contract.
 *
 * The model sometimes restates a sentence it isn't changing, from next to its
 * quote or from another clause. Inserting that sentence prints it twice once
 * the changes are accepted. A proposal that opens with a long run of existing
 * wording, and quotes nothing, is a rewrite of a clause it never located.
 */

/** Words a sentence needs before its repetition counts. Short phrases recur in any contract. */
const MIN_SENTENCE_WORDS = 8;

/** Opening words that mark a quote-less proposal as a rewrite of existing wording. */
const REWRITE_OPENING_WORDS = 12;

const flat = (s: string) => s.replace(/\s+/g, " ").trim();
const wordCount = (s: string) => (s.match(/\S+/g) ?? []).length;

function sentences(text: string): string[] {
  return text
    .split(/(?<=[.;?!]["'”’)\]]*)\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export interface Restated {
  language: string;
  /** Sentences left out because the contract already has them. */
  dropped: string[];
}

/**
 * Leaves out each proposal sentence the contract already has word for word.
 *
 * `keep` holds wording a sentence must not be dropped for: the sentences other
 * findings strike, and the span this change replaces. The contract loses
 * those, so dropping them here would lose them altogether. A proposal made
 * only of restated sentences is left whole, because that is the model's full
 * wording.
 */
export function dropRestated(language: string, contract: string, keep: string[]): Restated {
  const text = flat(contract);
  const protectedText = keep.map(flat);

  const kept: string[] = [];
  const dropped: string[] = [];
  for (const sentence of sentences(language)) {
    const s = flat(sentence);
    const repeated =
      wordCount(s) >= MIN_SENTENCE_WORDS && text.includes(s) && !protectedText.some((p) => p.includes(s));
    (repeated ? dropped : kept).push(sentence);
  }

  if (dropped.length === 0 || kept.length === 0) return { language, dropped: [] };
  return { language: kept.join(" "), dropped };
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
