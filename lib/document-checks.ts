import type { DocumentNote } from "./document-notes";

/**
 * Arithmetic the contract gets wrong, checked by the app.
 *
 * The model reads tables and dates but doesn't reliably add them up. A real
 * contract had a room block table whose totals were off in three places and
 * three suite bookings whose night counts didn't match their dates, and the
 * model's notes named none of them. These checks are certain where they
 * speak, so they speak only when the document's shape is unambiguous.
 *
 * Both read the stored review text, where "#" marks a heading and "|"
 * separates table cells.
 */

export interface CheckNote extends DocumentNote {
  source: "check";
}

const NUMBER = /^\$?(\d{1,3}(?:,\d{3})+|\d+)(\.\d+)?$/;

function numberIn(cell: string): number | null {
  const m = cell.trim().match(NUMBER);
  return m ? Number(m[0].replace(/[$,]/g, "")) : null;
}

const fmt = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 2 });
const isTotal = (cell: string) => /^total\b/i.test(cell.trim());
const differs = (a: number, b: number) => Math.abs(a - b) > 0.005;

function headingCase(heading: string): string {
  return heading === heading.toUpperCase() ? heading.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()) : heading;
}

interface Table {
  heading: string | null;
  rows: string[][];
}

function tables(text: string): Table[] {
  const found: Table[] = [];
  let heading: string | null = null;
  let current: string[][] | null = null;

  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("|")) {
      const cells = trimmed.replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
      if (cells.every((c) => /^-{3,}$/.test(c))) continue;
      (current ??= []).push(cells);
      continue;
    }
    if (current) {
      found.push({ heading, rows: current });
      current = null;
    }
    const h = trimmed.match(/^#+\s+(.+)$/);
    if (h && h[1].trim()) heading = h[1].trim();
  }
  if (current) found.push({ heading, rows: current });
  return found;
}

/** Rows and columns whose figures don't add up to the total the table states. */
function tableMismatches({ rows }: Table): string[] {
  const [header, ...body] = rows;
  if (!header || body.length === 0) return [];
  const mismatches: string[] = [];

  const totalCol = header.findLastIndex(isTotal);
  if (totalCol > 0) {
    for (const row of body) {
      const total = numberIn(row[totalCol] ?? "");
      if (total === null) continue;
      const addends = row.map((c, i) => (i === 0 || i === totalCol ? null : numberIn(c))).filter((n) => n !== null);
      if (addends.length < 2) continue;
      const sum = addends.reduce((a, b) => a + b, 0);
      if (differs(sum, total)) mismatches.push(`${row[0] || "A row"} adds up to ${fmt(sum)}, but its total says ${fmt(total)}`);
    }
  }

  const totalRow = body.findIndex((row) => isTotal(row[0] ?? ""));
  if (totalRow > 0) {
    // A row of labels under the header, such as dates, names the column better than the header alone.
    const labels = body.find((row) => row.slice(1).every((c) => numberIn(c) === null) && row.slice(1).some(Boolean));
    for (let col = 1; col < header.length; col++) {
      const total = numberIn(body[totalRow][col] ?? "");
      if (total === null) continue;
      const addends = body
        .slice(0, totalRow)
        .map((row) => numberIn(row[col] ?? ""))
        .filter((n) => n !== null);
      if (addends.length < 2) continue;
      const sum = addends.reduce((a, b) => a + b, 0);
      if (!differs(sum, total)) continue;
      const name = [header[col], labels?.[col]].filter(Boolean).join(" ") || `Column ${col + 1}`;
      mismatches.push(`${name} adds up to ${fmt(sum)}, but the ${body[totalRow][0]} row says ${fmt(total)}`);
    }
  }

  return mismatches;
}

function tableNotes(text: string): CheckNote[] {
  return tables(text).flatMap((table) => {
    const mismatches = tableMismatches(table);
    if (mismatches.length === 0) return [];
    const name = table.heading ? `The ${headingCase(table.heading)} table's` : "A table's";
    const places = mismatches.length === 1 ? "one place" : `${mismatches.length} places`;
    return [
      {
        source: "check" as const,
        headline: `${name} totals don't add up in ${places}.`,
        detail: `${mismatches.join("; ")}.`,
      },
    ];
  });
}

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const DATE = new RegExp(`\\b(${MONTHS.join("|")})\\s+(\\d{1,2}),\\s*(\\d{4})`, "gi");
const STAY = /\b([a-z-]+ \(\d+\))\s+(.{3,60}?)\s+for\s+([a-z-]+ \((\d+)\) nights?)/i;

function nightCountNotes(text: string): CheckNote[] {
  const mismatches: string[] = [];

  for (const paragraph of text.split("\n")) {
    const stay = paragraph.match(STAY);
    if (!stay) continue;
    const dates = [...paragraph.matchAll(DATE)];
    const arrives = paragraph.search(/arriv/i);
    const departs = paragraph.search(/depart/i);
    if (dates.length !== 2 || arrives === -1 || departs === -1) continue;

    const [first, second] = dates;
    const [arrival, departure] = arrives < departs ? [first, second] : [second, first];
    const day = (m: RegExpMatchArray) => Date.UTC(Number(m[3]), MONTHS.indexOf(m[1].toLowerCase()), Number(m[2]));
    const nights = Math.round((day(departure) - day(arrival)) / 86_400_000);
    const stated = Number(stay[4]);
    if (nights <= 0 || nights === stated) continue;

    const what = `${stay[1]} ${stay[2]}`;
    mismatches.push(
      `${what[0].toUpperCase()}${what.slice(1)} for "${stay[3]}", but ${arrival[0]} to ${departure[0]} is ${nights} night${nights === 1 ? "" : "s"}`
    );
  }

  if (mismatches.length === 0) return [];
  return [
    {
      source: "check",
      headline:
        mismatches.length === 1
          ? "A booking's night count doesn't match its dates."
          : `${mismatches.length} bookings give a night count that doesn't match their dates.`,
      detail: `${mismatches.join("; ")}.`,
    },
  ];
}

export function checkDocument(text: string | null): CheckNote[] {
  if (!text) return [];
  return [...tableNotes(text), ...nightCountNotes(text)];
}
