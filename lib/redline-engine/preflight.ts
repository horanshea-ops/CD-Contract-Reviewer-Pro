import { figureCheck } from "../proposed-figures";
import { dropRestated, rewritesExistingWording, struckSentences } from "./restated";
import { wordingProblem } from "./wording";
import { rowCells, splitAcrossCells } from "./cell-split";
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
  /** One sentence for the card when a proposed amount doesn't follow from its formula. The change still exports. */
  figure_check?: string;
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
  if (language.includes("|")) return rowCells(language).length === cells.length;
  return splitAcrossCells(cells, language) !== null;
}

export function previewFindings(findings: PreviewFinding[], contractText: string | null): Map<string, FindingPreview> {
  const struck = struckSentences(findings);
  const previews = new Map<string, FindingPreview>();

  for (const f of findings) {
    const language = f.language.trim();
    if (!language) {
      previews.set(f.id, {
        export_issue: "No wording proposed, so this won't go into the redline. The memo still lists it. Use Edit to add wording.",
        redline_language: null,
      });
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
        export_issue: `Not in the redline. This change is to a table row with ${cells.length} columns, and its wording isn't split to match. Use Edit to write one value per column, with | between them.`,
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
          "This change won't go into the redline. It rewords wording the contract already has without saying which wording to replace, so adding it would leave both versions. Raise it with the property separately.",
        redline_language: null,
      });
      continue;
    }

    const restated = dropRestated(language, contractText, f.quoted_text ? [...struck, f.quoted_text] : struck);
    const changed = restated.dropped.length + restated.reworded.length > 0;
    previews.set(f.id, {
      export_issue:
        restated.reworded.length > 0
          ? `The redline leaves out one sentence of this change ("${opening(restated.reworded[0])}"). That sentence rewords one the contract already has, and this change doesn't replace the original, so adding it would leave both versions. The rest goes in as shown. Raise that sentence separately if it matters.`
          : null,
      redline_language: changed ? restated.language : null,
    });
  }

  for (const f of findings) {
    const preview = previews.get(f.id);
    const figure_check = figureCheck(f.quoted_text, f.language);
    if (preview && figure_check) previews.set(f.id, { ...preview, figure_check });
  }

  return previews;
}
