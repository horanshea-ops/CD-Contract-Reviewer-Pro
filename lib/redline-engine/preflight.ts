import { dropRestated, rewritesExistingWording, struckSentences } from "./restated";
import { wordingProblem } from "./wording";
import { splitAcrossCells } from "./cell-split";
import { locateQuote } from "./locate";
import { isLocated } from "./types";

/**
 * What the redline will do with each finding, worked out before export.
 *
 * The engine only says why it left a change out once the associate exports.
 * These are the same checks, run when the review screen loads, so a card can
 * say up front that its change won't go in and show the wording that will.
 *
 * The contract text here is the stored review text, which marks tables with
 * "|". A sentence inside a table may go unmatched, so this can miss a
 * restatement the engine catches, but never reports one the engine wouldn't.
 */

export interface PreviewFinding {
  id: string;
  quoted_text: string | null;
  is_missing_clause: boolean;
  /** The wording that would be exported: the associate's edit, or the proposal. */
  language: string;
}

export interface FindingPreview {
  /** One sentence for the card when the change, or part of it, won't go into the redline. */
  export_issue: string | null;
  /** The wording the redline will insert, when it differs from `language`. */
  redline_language: string | null;
}

const NONE: FindingPreview = { export_issue: null, redline_language: null };

function opening(sentence: string): string {
  const words = sentence.trim().split(/\s+/);
  return words.length > 8 ? `${words.slice(0, 8).join(" ").replace(/[,;:]$/, "")}…` : sentence.trim();
}

/**
 * The table cells a quote covers. A quote that leaves out the "|" between
 * cells is found in the review text to see which cells it runs across.
 */
function quoteCells(quote: string | null, contractText: string | null): string[] {
  const split = (text: string) => text.split("|").map((c) => c.trim()).filter(Boolean);
  if (!quote) return [];
  if (quote.includes("|") || !contractText?.includes("|")) return split(quote);

  const span = locateQuote([{ part: "review", text: contractText }], quote, null);
  if (!isLocated(span) || span.resolution === "fuzzy") return [quote];
  return split(contractText.slice(span.start, span.end));
}

/** Whether the wording can be laid out across the cells, as the engine's table replacement does it. */
function fitsCells(cells: string[], language: string): boolean {
  if (language.includes("|")) return language.split("|").length === cells.length;
  return splitAcrossCells(cells, language) !== null;
}

export function previewFindings(findings: PreviewFinding[], contractText: string | null): Map<string, FindingPreview> {
  const struck = struckSentences(findings);
  const previews = new Map<string, FindingPreview>();

  for (const f of findings) {
    const language = f.language.trim();
    if (!language) {
      previews.set(f.id, NONE);
      continue;
    }

    const problem = wordingProblem(language, f.quoted_text);
    if (problem) {
      const blank = problem.detail.match(/: (\[.*\])\.$/)?.[1];
      previews.set(f.id, {
        export_issue:
          problem.reason === "unfilled_blank"
            ? `Won't go into the redline yet: the wording still has a blank, ${blank ?? "[X]"}. Use Edit to fill it in.`
            : "Won't go into the redline: the wording reads as an instruction, not contract wording. Use Edit to rewrite it.",
        redline_language: null,
      });
      continue;
    }

    // The engine lays a change across a table row cell by cell.
    const cells = quoteCells(f.quoted_text, contractText);
    if (cells.length > 1 && !fitsCells(cells, language)) {
      previews.set(f.id, {
        export_issue: `Won't go into the redline: the quote spans ${cells.length} table cells, and the wording can't be laid out across them. Use Edit to change the cells one at a time, or raise it another way.`,
        redline_language: null,
      });
      continue;
    }

    if (!contractText) {
      previews.set(f.id, NONE);
      continue;
    }

    if (!f.quoted_text && rewritesExistingWording(language, contractText)) {
      previews.set(f.id, {
        export_issue:
          "Won't go into the redline: it rewrites wording already in the contract but quotes none of it, so there is nothing to mark up. Raise it with the property another way.",
        redline_language: null,
      });
      continue;
    }

    const restated = dropRestated(language, contractText, f.quoted_text ? [...struck, f.quoted_text] : struck);
    const changed = restated.dropped.length + restated.reworded.length > 0;
    previews.set(f.id, {
      export_issue:
        restated.reworded.length > 0
          ? `Part of this won't go in: the redline leaves out a rewrite of wording it doesn't quote ("${opening(restated.reworded[0])}"). Raise that change another way, or use Edit.`
          : null,
      redline_language: changed ? restated.language : null,
    });
  }

  return previews;
}
