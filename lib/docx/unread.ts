import { parseXml, type DocxPackage } from "./parts";
import { inSkippedCopy } from "./text-boxes";
import type { UnreadWording } from "./types";
import type { WalkResult } from "./walk";

/**
 * Wording in the file that the reader did not read, so the review can say so.
 *
 * The reader walks the structures it knows. Anything it passes over is
 * counted here from the file itself, along with footnotes and endnotes, which
 * live in parts the reader doesn't open.
 */

const SAMPLE_WORDS = 12;

/** Notes Word adds itself to draw the rule above the footnotes. */
const SEPARATOR_TYPES = new Set(["separator", "continuationSeparator", "continuationNotice"]);

const NOTE_PARTS = [
  { path: "word/footnotes.xml", tag: "w:footnote", where: "footnotes" },
  { path: "word/endnotes.xml", tag: "w:endnote", where: "endnotes" },
];

const wordsIn = (text: string) => text.split(/\s+/).filter(Boolean);

function entry(where: string, pieces: string[]): UnreadWording | null {
  const words = wordsIn(pieces.join(" "));
  if (words.length === 0) return null;
  return { where, words: words.length, sample: words.slice(0, SAMPLE_WORDS).join(" ") };
}

const textOf = (node: Element): string[] => {
  const out: string[] = [];
  const texts = node.getElementsByTagName("w:t");
  for (let i = 0; i < texts.length; i++) out.push(texts[i].textContent ?? "");
  return out;
};

export async function findUnread(pkg: DocxPackage, parts: WalkResult[]): Promise<UnreadWording[]> {
  const found: UnreadWording[] = [];

  // Wording in a part the reader walked, inside a structure it passed over.
  const passedOver: string[] = [];
  for (const part of pkg.textParts) {
    const walked = parts.find((p) => p.part === part.name);
    const reached = new Set<Node>(walked?.runs ?? []);
    const texts = part.doc.getElementsByTagName("w:t");
    for (let i = 0; i < texts.length; i++) {
      const text = texts[i];
      if (!text.textContent?.trim() || !text.parentNode || reached.has(text.parentNode)) continue;
      if (!inSkippedCopy(text)) passedOver.push(text.textContent);
    }
  }
  const body = entry("a part of the file the review can't read", passedOver);
  if (body) found.push(body);

  for (const { path, tag, where } of NOTE_PARTS) {
    const file = pkg.zip.file(path);
    if (!file) continue;
    let doc: Document;
    try {
      doc = parseXml(await file.async("string"), path);
    } catch {
      continue;
    }
    const pieces: string[] = [];
    const notes = doc.getElementsByTagName(tag);
    for (let i = 0; i < notes.length; i++) {
      if (!SEPARATOR_TYPES.has(notes[i].getAttribute("w:type") ?? "")) pieces.push(...textOf(notes[i]));
    }
    const note = entry(where, pieces);
    if (note) found.push(note);
  }

  return found;
}
