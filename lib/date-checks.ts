import type { CheckNote } from "./document-checks";
import { tables } from "./text-tables";

/**
 * Dates the contract contradicts itself on, checked by the app.
 *
 * A real contract ran its function schedule two days past the event, checked
 * twenty rooms out before they checked in, and gave a cancellation tier that
 * ended before it began. Each check speaks only when every date it compares
 * was read without guessing.
 */

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const MONTH = `(${MONTHS.join("|")})`;
const ORDINAL = "(?:st|nd|rd|th)?";

const MONTH_FIRST = new RegExp(`\\b${MONTH}\\s+(\\d{1,2})${ORDINAL},?\\s+(\\d{4})\\b`, "gi");
const DAY_FIRST = new RegExp(`\\b(\\d{1,2})${ORDINAL}\\s+(?:of\\s+)?${MONTH},?\\s+(\\d{4})\\b`, "gi");

// Some contracts carry stray spaces inside numeric dates, as in "01 /1 0/2027".
const NUMERIC = /(?<![\d/])(\d(?: ?\d)?) ?\/ ?(\d(?: ?\d)?) ?\/ ?(\d(?: ?\d){3})(?![\d/])/g;

type Order = "day_first" | "month_first";

export interface ContractDate {
  /** Days since 1970-01-01. */
  day: number;
  /** As the contract writes it, with stray spaces removed from numeric dates. */
  text: string;
  index: number;
  end: number;
}

const digits = (s: string) => Number(s.replace(/ /g, ""));

function toDay(year: number, month: number, date: number): number | null {
  const ms = Date.UTC(year, month - 1, date);
  const d = new Date(ms);
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== date) return null;
  return ms / 86_400_000;
}

/**
 * Whether the contract writes numeric dates day first or month first, judged
 * from the dates that can only be read one way. Null when none can, or when
 * the contract uses both.
 */
export function numericOrder(text: string): Order | null {
  let dayFirst = false;
  let monthFirst = false;
  for (const m of text.matchAll(NUMERIC)) {
    if (digits(m[1]) > 12) dayFirst = true;
    if (digits(m[2]) > 12) monthFirst = true;
  }
  if (dayFirst === monthFirst) return null;
  return dayFirst ? "day_first" : "month_first";
}

/** Every date in `text`, in order. Numeric dates are read only when `order` is known. */
export function datesIn(text: string, order: Order | null): ContractDate[] {
  const found: ContractDate[] = [];
  const add = (m: RegExpMatchArray, day: number | null, shown: string) => {
    if (day !== null) found.push({ day, text: shown, index: m.index!, end: m.index! + m[0].length });
  };

  for (const m of text.matchAll(MONTH_FIRST)) add(m, toDay(Number(m[3]), MONTHS.indexOf(m[1].toLowerCase()) + 1, Number(m[2])), m[0]);
  for (const m of text.matchAll(DAY_FIRST)) add(m, toDay(Number(m[3]), MONTHS.indexOf(m[2].toLowerCase()) + 1, Number(m[1])), m[0]);
  if (order) {
    for (const m of text.matchAll(NUMERIC)) {
      const [a, b, year] = [digits(m[1]), digits(m[2]), digits(m[3])];
      const [date, month] = order === "day_first" ? [a, b] : [b, a];
      add(m, toDay(year, month, date), m[0].replace(/ /g, ""));
    }
  }

  found.sort((x, y) => x.index - y.index);
  return found.filter((d, i) => i === 0 || d.index >= found[i - 1].end);
}

interface Window {
  start: ContractDate;
  end: ContractDate;
}

const WINDOW_LABEL = /\b(?:event|meeting|program|programme|conference|group) dates?\b/i;

/** The event's first and last day, from a labelled line such as "Event Dates: 26/09/2027 to 02/10/2027". */
function eventWindow(lines: string[], order: Order | null): Window | null {
  for (const line of lines) {
    const label = line.match(WINDOW_LABEL);
    if (!label) continue;
    const dates = datesIn(line.slice(label.index! + label[0].length, label.index! + label[0].length + 120), order);
    if (dates.length >= 2 && dates[1].day >= dates[0].day) return { start: dates[0], end: dates[1] };
  }

  const labelled = (pattern: RegExp) => {
    for (const line of lines) {
      const label = line.match(pattern);
      if (label) return datesIn(line.slice(label.index! + label[0].length, label.index! + label[0].length + 60), order)[0];
    }
    return undefined;
  };
  const start = labelled(/\barrival date\b/i);
  const end = labelled(/\bdeparture date\b/i);
  return start && end && end.day >= start.day ? { start, end } : null;
}

const joined = (items: string[]) =>
  items.length <= 2 ? items.join(" and ") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;

/** Schedule rows dated before the event starts or after it ends. */
function scheduleNote(text: string, window: Window, order: Order | null): CheckNote | null {
  const before = new Set<string>();
  const after = new Set<string>();

  for (const { rows } of tables(text)) {
    const column = rows[0]?.findIndex((cell) => /^dates?$/i.test(cell.trim()));
    if (column === undefined || column === -1) continue;
    for (const row of rows.slice(1)) {
      for (const date of datesIn(row[column] ?? "", order)) {
        if (date.day < window.start.day) before.add(date.text);
        if (date.day > window.end.day) after.add(date.text);
      }
    }
  }

  if (before.size === 0 && after.size === 0) return null;
  const parts: string[] = [];
  if (before.size > 0) parts.push(`${joined([...before])}, before the event starts on ${window.start.text}`);
  if (after.size > 0) parts.push(`${joined([...after])}, after the event ends on ${window.end.text}`);
  return {
    source: "check",
    headline: "The schedule lists dates outside the event.",
    detail: `A schedule lists ${parts.join(", and ")}.`,
  };
}

const STAY_KEYS: [RegExp, RegExp][] = [
  [/\bcheck[- ]?in\b/i, /\bcheck[- ]?out\b/i],
  [/\barriv(?:al|e|es|ing)\b/i, /\bdepart(?:ure|s|ing)?\b/i],
];

/** Bookings whose check-out date is not after their check-in date. */
function stayNote(lines: string[], order: Order | null): CheckNote | null {
  const backwards: string[] = [];

  for (const line of lines) {
    for (const [inKey, outKey] of STAY_KEYS) {
      const checkIn = line.match(inKey);
      const checkOut = line.match(outKey);
      if (!checkIn || !checkOut || checkOut.index! < checkIn.index!) continue;

      const dates = datesIn(line, order);
      const arrives = dates.find((d) => d.index > checkIn.index! && d.index < checkOut.index!);
      const leaves = dates.find((d) => d.index > checkOut.index!);
      if (!arrives || !leaves || leaves.day > arrives.day) continue;
      backwards.push(`checks in on ${arrives.text} and out on ${leaves.text}`);
      break;
    }
  }

  if (backwards.length === 0) return null;
  return {
    source: "check",
    headline: backwards.length === 1 ? "A booking checks out before it checks in." : `${backwards.length} bookings check out before they check in.`,
    detail: `${backwards.map((b, i) => (i === 0 ? `A booking ${b}` : `another ${b}`)).join("; ")}.`,
  };
}

const RANGE_START = /\b(?:between|from)\b/gi;
const RANGE_JOIN = /^\s*(?:and|to|until|through|-|–)\s*$/i;

/** "Between X and Y" ranges where Y comes before X. */
function rangeNote(lines: string[], order: Order | null): CheckNote | null {
  const backwards: string[] = [];

  for (const line of lines) {
    const dates = datesIn(line, order);
    for (const start of line.matchAll(RANGE_START)) {
      const next = dates.filter((d) => d.index > start.index!).slice(0, 2);
      if (next.length < 2 || next[0].index - start.index! > 60) continue;
      const [from, to] = next;
      if (!RANGE_JOIN.test(line.slice(from.end, to.index)) || to.day >= from.day) continue;
      backwards.push(`"${line.slice(start.index!, to.end).replace(/\s+/g, " ")}"`);
    }
  }

  if (backwards.length === 0) return null;
  return {
    source: "check",
    headline: backwards.length === 1 ? "A date range ends before it starts." : `${backwards.length} date ranges end before they start.`,
    detail:
      backwards.length === 1
        ? `The contract gives a range ${backwards[0]}, which ends before it starts.`
        : `The contract gives ranges ${joined(backwards)}, which each end before they start.`,
  };
}

export function dateNotes(text: string): CheckNote[] {
  const order = numericOrder(text);
  const lines = text.split("\n");
  const window = eventWindow(lines, order);
  return [window && scheduleNote(text, window, order), stayNote(lines, order), rangeNote(lines, order)].filter(
    (note): note is CheckNote => note !== null
  );
}
