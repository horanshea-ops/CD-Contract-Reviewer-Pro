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
