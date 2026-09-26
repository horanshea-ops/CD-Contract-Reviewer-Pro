/**
 * The model's notes on the document as a whole, as short items.
 *
 * Each note is one short sentence the associate reads first, with a little
 * more behind it. The model is asked for that shape, and this module holds it
 * to it: a headline is cut to its first sentence, and to about twenty words,
 * with the rest moved into the detail, which keeps two sentences. Notes saved
 * as one block of text, before the list existed, read the same way.
 */

export interface DocumentNote {
  headline: string;
  detail: string;
}

const MAX_DETAIL_SENTENCES = 2;
const MAX_HEADLINE_WORDS = 20;

function sentences(text: string): string[] {
  return text
    .replace(/\s+/g, " ")
    .trim()
    .split(/(?<=[.!?]["'”’)]?)\s+(?=["'“‘(]?[A-Z0-9])/)
    .filter(Boolean);
}

/** A note from its sentences: the first is the headline, and a long one moves whole into the detail. */
function note([first, ...rest]: string[]): DocumentNote | null {
  if (!first) return null;
  const words = first.split(" ");
  if (words.length <= MAX_HEADLINE_WORDS) {
    return { headline: first, detail: rest.slice(0, MAX_DETAIL_SENTENCES).join(" ") };
  }
  return {
    headline: `${words.slice(0, MAX_HEADLINE_WORDS - 4).join(" ").replace(/[,;:]$/, "")}…`,
    detail: [first, ...rest].slice(0, MAX_DETAIL_SENTENCES).join(" "),
  };
}

const fromText = (text: string) => note(sentences(text));

function fromItem(item: unknown): DocumentNote | null {
  if (typeof item === "string") return fromText(item);
  if (!item || typeof item !== "object") return null;
  const { headline, detail } = item as { headline?: unknown; detail?: unknown };
  if (typeof headline !== "string" || !headline.trim()) return null;
  return note([...sentences(headline), ...(typeof detail === "string" ? sentences(detail) : [])]);
}

/** Notes from whatever was stored or returned: a list, a JSON string of one, or plain text. */
export function toNotes(value: unknown): DocumentNote[] {
  let items: unknown = value;
  if (typeof value === "string") {
    try {
      const decoded: unknown = JSON.parse(value);
      items = Array.isArray(decoded) ? decoded : value;
    } catch {
      items = value;
    }
  }
  const list = Array.isArray(items) ? items : [items];
  return list
    .map(fromItem)
    .filter((n): n is DocumentNote => n !== null);
}

const MONTH_NAMES = "january|february|march|april|may|june|july|august|september|october|november|december";
const FACT_PATTERNS = [
  /\b\d{1,2}\/\d{1,2}\/\d{4}\b/g,
  new RegExp(`\\b(?:${MONTH_NAMES})\\s+\\d{1,2}(?:st|nd|rd|th)?,?\\s+\\d{4}\\b`, "gi"),
  new RegExp(`\\b\\d{1,2}(?:st|nd|rd|th)?\\s+(?:${MONTH_NAMES}),?\\s+\\d{4}\\b`, "gi"),
  /[$€£]\s?\d[\d,]*(?:\.\d{1,2})?|\b\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?\b/g,
];

/** The dates and amounts a note names, written one way so two notes can be compared. */
function factsIn(note: DocumentNote): Set<string> {
  const text = `${note.headline} ${note.detail}`;
  const facts = new Set<string>();
  for (const pattern of FACT_PATTERNS) {
    for (const [match] of text.matchAll(pattern)) {
      const money = /^[$€£\d]/.test(match) && !match.includes("/") ? Number(match.replace(/[^\d.]/g, "")) : null;
      facts.add(money !== null && Number.isFinite(money) ? String(money) : match.toLowerCase().replace(/(\d)(st|nd|rd|th)\b/g, "$1").replace(/[,\s]+/g, " "));
    }
  }
  return facts;
}

/**
 * The model's notes without those that repeat one of the app's own checks.
 * A note repeats a check when both name at least two of the same dates or
 * amounts. The check stays, because the app worked it out.
 */
export function withoutRepeats(notes: DocumentNote[], checks: DocumentNote[]): DocumentNote[] {
  const checked = checks.map(factsIn);
  return notes.filter((note) => {
    const facts = factsIn(note);
    return !checked.some((c) => [...facts].filter((f) => c.has(f)).length >= 2);
  });
}
