/**
 * The content check on a redline comment (CLAUDE.md deviation 8).
 *
 * The allowlist in ./assembly.ts controls which field reaches the document.
 * This controls what that field says. The model writes the note while reading
 * CD's standard, so a permitted field can still carry CD's position, and only a
 * check on the words themselves catches that.
 *
 * Heuristic by nature. It refuses the common shapes of a leak, a figure or a
 * word about CD's own stance, and it cannot read intent. A person can still
 * phrase a position past it.
 */

export const NOTE_MAX_WORDS = 25;
export const NOTE_MAX_CHARS = 160;
/** Fewer words than this is a label or a filler word, such as "placeholder" or "N/A", and the hotel would read it. */
export const NOTE_MIN_WORDS = 3;

/**
 * Words that describe CD's side of the negotiation rather than what a change
 * does. "Standard rooms" is a room type, so it is allowed.
 */
const DENIED: { pattern: RegExp; word: string }[] = [
  { pattern: /\bCD\b/, word: "CD" },
  { pattern: /\bconference\s*direct\b/i, word: "ConferenceDirect" },
  { pattern: /\bstandards?\b(?!\s+rooms?\b)/i, word: "standard" },
  { pattern: /\bpositions?\b/i, word: "position" },
  { pattern: /\bfall[\s-]?backs?\b/i, word: "fallback" },
  { pattern: /\bwalk[\s-]?away\b/i, word: "walk away" },
  { pattern: /\bcompromis\w*/i, word: "compromise" },
  { pattern: /\bleverage\b/i, word: "leverage" },
  { pattern: /\btargets?\b/i, word: "target" },
  { pattern: /\bbenchmarks?\b/i, word: "benchmark" },
  { pattern: /\bindustry\b/i, word: "industry" },
  { pattern: /\bnegotiat\w*/i, word: "negotiate" },
  { pattern: /\bpercent\b/i, word: "percent" },
  { pattern: /\bour client\b/i, word: "our client" },
];

const STOPWORDS = new Set(
  "a an and are as at be by for from has in is it its no not of on or that the this to with will shall group hotel".split(" ")
);

const words = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .split(/\s+/)
    .filter(Boolean);

/** Four-word runs in which at least three words carry meaning. Shared filler is not a leak. */
function shingles(s: string): Set<string> {
  const w = words(s);
  const out = new Set<string>();
  for (let i = 0; i + 4 <= w.length; i++) {
    const run = w.slice(i, i + 4);
    if (run.filter((x) => !STOPWORDS.has(x)).length >= 3) out.add(run.join(" "));
  }
  return out;
}

/** CD's internal text about the finding, for the overlap check. Server-side only. */
export interface NoteContext {
  cd_standard?: string | null;
  finding_text?: string | null;
  compromise_range?: string | null;
}

/**
 * Why a note can't go into the redline, in words an associate can act on, or
 * null when it can. An empty note is fine and means no comment.
 */
export function noteProblem(note: string, context: NoteContext = {}): string | null {
  const text = note.trim();
  if (!text) return null;

  if (words(text).length < NOTE_MIN_WORDS) {
    return "Say what the change does for the group in a full sentence, or leave the comment empty.";
  }
  if (text.length > NOTE_MAX_CHARS || words(text).length > NOTE_MAX_WORDS) {
    return `Keep the comment to one short sentence, at most ${NOTE_MAX_WORDS} words.`;
  }
  if (/\d/.test(text) || /[$%£€]/.test(text)) {
    return "Leave figures out of the comment. The change itself shows the new terms.";
  }
  const denied = DENIED.find((d) => d.pattern.test(text));
  if (denied) {
    return `"${denied.word}" describes CD's side of the negotiation. Say what the change does for the group instead.`;
  }

  const mine = shingles(text);
  for (const source of [context.cd_standard, context.finding_text, context.compromise_range]) {
    if (!source) continue;
    const theirs = shingles(source);
    if ([...mine].some((s) => theirs.has(s))) {
      return "The comment repeats wording from CD's internal notes on this finding. Rephrase it.";
    }
  }
  return null;
}

/** The note as stored: kept when it passes, blank when it doesn't. */
export function sanitizeNote(note: string | null | undefined, context: NoteContext = {}): string {
  const text = (note ?? "").replace(/\s+/g, " ").trim();
  return noteProblem(text, context) ? "" : text;
}
