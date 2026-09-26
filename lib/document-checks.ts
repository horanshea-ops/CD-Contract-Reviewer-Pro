import { dateNotes } from "./date-checks";
import type { DocumentNote } from "./document-notes";
import { tables, type Table } from "./text-tables";

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

const NUMBER = /^[$€£]?\s*(\d{1,3}(?:,\d{3})+|\d+)(\.\d+)?$/;

function numberIn(cell: string): number | null {
  const m = cell.trim().match(NUMBER);
  return m ? Number(m[0].replace(/[$€£,\s]/g, "")) : null;
}

const fmt = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 2 });
const isTotal = (cell: string) => /^total\b/i.test(cell.trim());
const differs = (a: number, b: number) => Math.abs(a - b) > 0.005;

function headingCase(heading: string): string {
  return heading === heading.toUpperCase() ? heading.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()) : heading;
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

const MIN_LEDGER_AMOUNTS = 3;

/**
 * Totals in a two-column table of labels and amounts, such as a revenue
 * summary. Read top to bottom, a "Total" row must equal the amounts since the
 * last total, or the last total plus them.
 *
 * Line items are often labelled "Total" too ("Total Room Rental Revenue"). A
 * sum can't be smaller than its parts, so a "Total" row smaller than anything
 * above it, or with nothing above it, counts as a line item.
 */
function ledgerMismatches({ rows }: Table): string[] {
  const entries: { label: string; amount: number }[] = [];
  for (const row of rows) {
    const cells = row.filter((c) => c.trim());
    if (cells.length === 0) continue;
    const amounts = cells.map(numberIn);
    const found = amounts.filter((n) => n !== null);
    if (found.length > 1) return [];
    if (found.length === 0) continue;
    if (amounts[amounts.length - 1] === null || cells.length < 2) return [];
    entries.push({ label: cells[0], amount: found[0] });
  }
  if (entries.length < MIN_LEDGER_AMOUNTS) return [];

  const mismatches: string[] = [];
  let lastTotal: number | null = null;
  let since: number[] = [];
  for (const { label, amount } of entries) {
    const above = lastTotal === null ? since : [lastTotal, ...since];
    if (!isTotal(label) || above.length === 0 || above.some((n) => n > amount)) {
      since.push(amount);
      continue;
    }
    const sinceSum = since.reduce((a, b) => a + b, 0);
    const addends = lastTotal === null ? since : [lastTotal, ...since];
    if (addends.length >= 2 && differs(sinceSum, amount) && differs((lastTotal ?? 0) + sinceSum, amount)) {
      const sum = addends.reduce((a, b) => a + b, 0);
      mismatches.push(`${label} adds up to ${fmt(sum)} (${addends.map(fmt).join(" + ")}), but the table says ${fmt(amount)}`);
    }
    lastTotal = amount;
    since = [];
  }
  return mismatches;
}

function tableNotes(text: string): CheckNote[] {
  return tables(text).flatMap((table) => {
    const mismatches = [...tableMismatches(table), ...ledgerMismatches(table)];
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

const MONEY = /([$€£])\s?(\d{1,3}(?:,\d{3})+|\d+)(\.\d{2})?/g;
const PERCENT = /(\d{1,3}(?:\.\d+)?)\s*\]?\s*%/;
const EXCLUSIVE_TAX = /(excluding|exclusive of|net of)[^.|]*tax/i;
const INCLUSIVE_TAX = /(including|inclusive of)[^.|]*tax/i;

const money = (symbol: string, n: number) =>
  `${symbol}${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Totals the document labels as including or excluding tax, from table rows of a label and an amount. */
function statedTotals(text: string): { inclusive: number[]; exclusive: number[] } {
  const inclusive: number[] = [];
  const exclusive: number[] = [];
  for (const { rows } of tables(text)) {
    for (const row of rows) {
      const cells = row.filter((c) => c.trim());
      const amount = cells.length >= 2 ? numberIn(cells[cells.length - 1]) : null;
      if (amount === null || !/total/i.test(cells[0])) continue;
      if (INCLUSIVE_TAX.test(cells[0])) inclusive.push(amount);
      else if (EXCLUSIVE_TAX.test(cells[0])) exclusive.push(amount);
    }
  }
  return { inclusive, exclusive };
}

/**
 * A payment schedule worked out on the wrong total: its amounts are
 * percentages of the total including tax, while the contract says they are
 * percentages of the total excluding it.
 */
function paymentScheduleNotes(text: string): CheckNote[] {
  const paragraphs = text.split("\n").map((p) => p.trim()).filter(Boolean);
  const { inclusive, exclusive } = statedTotals(text);
  if (inclusive.length === 0 || exclusive.length === 0) return [];

  const notes: CheckNote[] = [];
  let run: { pct: number; amount: number; symbol: string }[] = [];
  let runEnd = -1;

  const close = () => {
    if (run.length >= 2) {
      const bases = run.map((r) => r.amount / (r.pct / 100));
      const base = bases[0];
      const stated = paragraphs.slice(runEnd + 1, runEnd + 4).join(" ");
      const exclusiveTotal = exclusive.find((e) => Math.abs(e - base) >= 1);
      if (
        bases.every((b) => Math.abs(b - base) < 0.5) &&
        inclusive.some((i) => Math.abs(i - base) < 0.5) &&
        exclusiveTotal !== undefined &&
        EXCLUSIVE_TAX.test(stated)
      ) {
        const [first] = run;
        notes.push({
          source: "check",
          headline: "A payment schedule is worked out on the total including tax.",
          detail:
            `The payments are ${run.map((r) => `${r.pct}%`).join(", ")} of ${money(first.symbol, base)}, the total including taxes, ` +
            `but the contract says the percentages refer to the total exclusive of tax (${money(first.symbol, exclusiveTotal)}). ` +
            `On that total the first payment would be ${money(first.symbol, (first.pct / 100) * exclusiveTotal)}, not ${money(first.symbol, first.amount)}.`,
        });
      }
    }
    run = [];
  };

  paragraphs.forEach((paragraph, index) => {
    const pct = paragraph.match(PERCENT);
    const amounts = [...paragraph.matchAll(MONEY)];
    const last = amounts[amounts.length - 1];
    if (pct && last && !paragraph.startsWith("|")) {
      run.push({ pct: Number(pct[1]), amount: Number(`${last[2]}${last[3] ?? ""}`.replace(/,/g, "")), symbol: last[1] });
      runEnd = index;
    } else close();
  });
  close();
  return notes;
}

type Picture = { near: string; readable?: boolean };

const where = (near: string) => (near ? ` near "${near}"` : "");

/** One note per picture, saying whether the review read it. */
export function pictureNotes(pictures: Picture[] | null | undefined): CheckNote[] {
  return (pictures ?? []).map(({ near, readable }) =>
    readable
      ? {
          source: "check" as const,
          headline: `The review read a picture${where(near)} as an image.`,
          detail: "The app can't check its figures or change it in the redline, so confirm any figure a finding takes from it.",
        }
      : {
          source: "check" as const,
          headline: `The contract has a picture${where(near)} that the review can't read.`,
          detail: "Check any figures in it, such as rates or room counts, by hand. Findings and exposures here don't use them.",
        }
  );
}

const places = (pictures: Picture[]) => pictures.map(({ near }) => `"${near}"`).join(" and ");

/**
 * What the model reads about pictures. Readable ones are attached after the
 * contract text, numbered in order. Their wording can't be quoted, because
 * quotes are checked against the text.
 */
export function pictureContext(pictures: Picture[] | null | undefined): string | undefined {
  if (!pictures?.length) return undefined;
  const sent = pictures.filter((p) => p.readable);
  const unread = pictures.filter((p) => !p.readable);
  const lines: string[] = [];
  if (sent.length > 0) {
    const one = sent.length === 1;
    lines.push(
      `${one ? "A picture from the contract is" : `${sent.length} pictures from the contract are`} attached after the contract text. ` +
        `Read ${one ? "it" : "them"} as part of the contract. ${one ? "Its" : "Their"} wording isn't in the contract text, ` +
        "so don't put it in quoted_text or deal_figures. Name the picture in your reasoning instead. " +
        "Check its figures and dates against the text: totals, rates, room counts, and its first and last nights against the arrival and departure dates. " +
        "Record any mismatch as a note naming the picture, and use its figures in findings where they bear on a clause."
    );
  }
  if (unread.length > 0) {
    lines.push(
      `The contract has ${unread.length === 1 ? "a picture" : "pictures"} near ${places(unread)} that this text leaves out. ` +
        "Their contents weren't read, so don't infer figures from them."
    );
  }
  return lines.join("\n\n");
}

export function checkDocument(text: string | null): CheckNote[] {
  if (!text) return [];
  return [...tableNotes(text), ...paymentScheduleNotes(text), ...nightCountNotes(text), ...dateNotes(text)];
}
