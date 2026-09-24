import { isSynthetic, type WalkResult } from "../docx";
import type { LocatedSpan } from "./types";

/**
 * Fitting the change to what the proposal actually replaces.
 *
 * The model quotes part of a sentence and sometimes writes its proposal for
 * more of it. Two cases follow, and both stay inside the quote's sentence:
 *
 * - The proposal repeats wording just before or after the quote. The change
 *   is stretched over that wording, so accepting it doesn't print the wording
 *   twice. The word-level diff then leaves the repeated words as they were.
 * - The proposal is written as whole sentences but the quote starts or ends
 *   partway through the contract's sentence. Accepting it would leave the
 *   rest of that sentence dangling, and only the model knows whether the rest
 *   should stay, so the change is refused.
 *
 * A loosely matched quote can also start or end partway through a word. The
 * change always covers whole words.
 * Nothing here looks past a paragraph, a table cell or anything else the
 * extractor invented, such as a tab or a list number.
 */

export type Fit =
  | { ok: true; span: LocatedSpan; language: string }
  | { ok: false; reason: "starts_mid_sentence" | "ends_mid_sentence"; detail: string };

/** How many words in a row mark a proposal's start or end as restated. */
const ANCHOR_WORDS = 3;

/** Share of the stretched-over wording the proposal must repeat. */
const MIN_RESTATED_SHARE = 0.5;

const SENTENCE_BREAK = /[.;:?!]["'”’)\]]*\s+/g;
const SENTENCE_END = /[.;?!]["'”’)\]]*(?=\s|$)/;
const ENDS_SENTENCE = /[.;?!]["'”’)\]]*\s*$/;
const TRAILING_PUNCTUATION = /[.,;:?!]+$/;

interface Word {
  text: string;
  start: number;
  end: number;
}

function wordsIn(text: string, from = 0, to = text.length): Word[] {
  return [...text.slice(from, to).matchAll(/\S+/g)].map((m) => ({
    text: m[0],
    start: from + m.index!,
    end: from + m.index! + m[0].length,
  }));
}

const bare = (word: string) => word.replace(TRAILING_PUNCTUATION, "");

const isWordCharacter = (c: string | undefined) => c !== undefined && /[\p{L}\p{N}]/u.test(c);

/**
 * True when the proposal opens a sentence: its first word is capitalised and
 * isn't a name. A word the contract capitalises after a lowercase word, such
 * as "Group" or "Hotel", is a name.
 */
function opensSentence(language: string, contract: string): boolean {
  const first = language.trimStart().match(/^[\p{Lu}][\p{L}'’-]*/u)?.[0];
  if (!first) return false;
  const escaped = first.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // Spaces only, so a heading's last word doesn't count as the word before.
  return !new RegExp(`[a-z,;][ \\t]+${escaped}\\b`, "u").test(contract);
}

/** Same words in the same order. The last pair is compared without its closing punctuation. */
function sameRun(a: Word[], b: Word[]): boolean {
  if (a.length !== b.length || a.length === 0) return false;
  return a.every((w, i) => (i === a.length - 1 ? bare(w.text) === bare(b[i].text) : w.text === b[i].text));
}

function commonCount(a: Word[], b: Word[]): number {
  let previous = new Array<number>(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    const row = new Array<number>(b.length + 1).fill(0);
    for (let j = 1; j <= b.length; j++) {
      row[j] = a[i - 1].text === b[j - 1].text ? previous[j - 1] + 1 : Math.max(previous[j], row[j - 1]);
    }
    previous = row;
  }
  return previous[b.length];
}

/** True when the proposal repeats at least half of `stretch`, somewhere in `near`. */
const restates = (stretch: Word[], near: Word[]) => commonCount(stretch, near) >= stretch.length * MIN_RESTATED_SHARE;

/** The span's paragraph text either side of it, stopping at anything the extractor invented. */
function paragraphAround(part: WalkResult, span: LocatedSpan): { from: number; to: number } | null {
  const paragraphOf = (i: number) => {
    const entry = part.map[i];
    return entry && !isSynthetic(entry) ? entry.paragraphIndex : null;
  };

  const inside = new Set<number>();
  for (let i = span.start; i < span.end; i++) {
    const p = paragraphOf(i);
    if (p !== null) inside.add(p);
  }
  if (inside.size !== 1) return null;
  const paragraph = [...inside][0];

  let from = span.start;
  while (from > 0 && paragraphOf(from - 1) === paragraph) from--;
  let to = span.end;
  while (to < part.text.length && paragraphOf(to) === paragraph) to++;
  return { from, to };
}

function sentenceStart(text: string, from: number, at: number): number {
  let start = from;
  for (const m of text.slice(from, at).matchAll(SENTENCE_BREAK)) start = from + m.index! + m[0].length;
  return start;
}

function sentenceEnd(text: string, at: number, to: number): number {
  const m = text.slice(at, to).match(SENTENCE_END);
  return m ? at + m.index! + m[0].length : to;
}

export function fitToProposal(part: WalkResult, span: LocatedSpan, language: string): Fit {
  const around = paragraphAround(part, span);
  if (!around) return { ok: true, span, language };

  const text = part.text;
  let start = span.start;
  let end = span.end;
  while (start > around.from && isWordCharacter(text[start - 1]) && isWordCharacter(text[start])) start--;
  while (end < around.to && isWordCharacter(text[end - 1]) && isWordCharacter(text[end])) end++;

  const proposal = wordsIn(language);
  const quote = wordsIn(text, start, end);
  let fitted = language;

  if (proposal.length >= ANCHOR_WORDS && !sameRun(quote.slice(0, ANCHOR_WORDS), proposal.slice(0, ANCHOR_WORDS))) {
    const before = wordsIn(text, sentenceStart(text, around.from, start), start);
    const words = [...before, ...quote];
    const opening = proposal.slice(0, ANCHOR_WORDS);
    for (let k = before.length - 1; k >= 0; k--) {
      if (!sameRun(words.slice(k, k + ANCHOR_WORDS), opening)) continue;
      const stretch = before.slice(k);
      if (restates(stretch, proposal.slice(0, stretch.length + 5))) start = stretch[0].start;
      break;
    }
  }

  if (proposal.length >= ANCHOR_WORDS && !sameRun(quote.slice(-ANCHOR_WORDS), proposal.slice(-ANCHOR_WORDS))) {
    const after = wordsIn(text, end, sentenceEnd(text, end, around.to));
    const words = [...quote, ...after];
    const closing = proposal.slice(-ANCHOR_WORDS);
    for (let e = quote.length; e < words.length; e++) {
      if (e - ANCHOR_WORDS + 1 < 0 || !sameRun(words.slice(e - ANCHOR_WORDS + 1, e + 1), closing)) continue;
      const stretch = after.slice(0, e - quote.length + 1);
      if (restates(stretch, proposal.slice(-(stretch.length + 5)))) {
        // The contract's sentence may carry on, so the proposal's last word
        // takes the contract's punctuation rather than ending the sentence.
        const last = proposal[proposal.length - 1];
        const theirs = words[e].text.slice(bare(words[e].text).length);
        fitted = language.slice(0, last.start) + bare(last.text) + theirs + language.slice(last.end);
        end = words[e].end;
      }
      break;
    }
  }

  const rest = text.slice(end, sentenceEnd(text, end, around.to));
  const carriesOn = !ENDS_SENTENCE.test(text.slice(start, end)) && /[\p{L}\p{N}]/u.test(rest);
  if (carriesOn && ENDS_SENTENCE.test(fitted)) {
    return {
      ok: false,
      reason: "ends_mid_sentence",
      detail: `The proposed wording ends the sentence, but the contract carries on: "${rest.trim().slice(0, 60)}".`,
    };
  }

  const lead = text.slice(sentenceStart(text, around.from, start), start);
  if (/[\p{L}\p{N}]/u.test(lead) && opensSentence(fitted, text) && ENDS_SENTENCE.test(fitted)) {
    return {
      ok: false,
      reason: "starts_mid_sentence",
      detail: `The proposed wording is a whole sentence, but the contract's sentence starts before the quote: "${lead.trim().slice(-60)}".`,
    };
  }

  return { ok: true, span: { ...span, start, end }, language: fitted };
}
