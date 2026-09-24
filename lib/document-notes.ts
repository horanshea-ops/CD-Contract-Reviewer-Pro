/**
 * The model's notes on the document as a whole, as short items.
 *
 * Each note is one sentence the associate reads first, with a little more
 * behind it. The model is asked for that shape, and this module holds it to
 * it: a headline is cut to its first sentence and the detail to two, whatever
 * the model sent. Notes saved as one block of text, before the list existed,
 * read the same way.
 */

export interface DocumentNote {
  headline: string;
  detail: string;
}

const MAX_NOTES = 5;
const MAX_DETAIL_SENTENCES = 2;

function sentences(text: string): string[] {
  return text
    .replace(/\s+/g, " ")
    .trim()
    .split(/(?<=[.!?]["'”’)]?)\s+(?=["'“‘(]?[A-Z0-9])/)
    .filter(Boolean);
}

function fromText(text: string): DocumentNote | null {
  const [headline, ...rest] = sentences(text);
  return headline ? { headline, detail: rest.slice(0, MAX_DETAIL_SENTENCES).join(" ") } : null;
}

function fromItem(item: unknown): DocumentNote | null {
  if (typeof item === "string") return fromText(item);
  if (!item || typeof item !== "object") return null;
  const { headline, detail } = item as { headline?: unknown; detail?: unknown };
  if (typeof headline !== "string" || !headline.trim()) return null;
  const [first, ...spill] = sentences(headline);
  const more = [...spill, ...(typeof detail === "string" ? sentences(detail) : [])];
  return { headline: first, detail: more.slice(0, MAX_DETAIL_SENTENCES).join(" ") };
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
    .filter((n): n is DocumentNote => n !== null)
    .slice(0, MAX_NOTES);
}
