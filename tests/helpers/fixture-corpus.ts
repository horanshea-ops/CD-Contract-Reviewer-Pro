import { readFile } from "node:fs/promises";
import path from "node:path";
import type { RevisionFinding } from "@/lib/redline-engine";

/**
 * The §1.11 fixture corpus, with a realistic finding for each document.
 *
 * Shared by the oracle's fixture test and by scripts/degradation-rate.ts, so
 * §1.6.6's rate is measured against the same corpus the tests assert on.
 */

export const FIXTURE_DIR = path.join("tests", "fixtures");
export const FIXTURE_AUTHOR = "Jane Associate";

let nextId = 0;

function finding(over: Partial<RevisionFinding> = {}): RevisionFinding {
  return {
    id: `fixture-${nextId++}`,
    location_section: null,
    clause_type: "attrition",
    severity: "high",
    is_missing_clause: false,
    quoted_text: null,
    language: "",
    finding_text: "Unfavourable to the client.",
    cd_standard: "CD position.",
    ...over,
  };
}

export interface FixtureCase {
  file: string;
  findings: RevisionFinding[];
}

export const FIXTURE_CORPUS: FixtureCase[] = [
  { file: "01-clean-simple.docx", findings: [finding({ quoted_text: "eighty percent (80%)", language: "seventy percent (70%)" })] },
  { file: "02-heavy-tables.docx", findings: [finding({ clause_type: "cancellation", quoted_text: "50%", language: "40%" })] },
  { file: "03-tracked-one-author.docx", findings: [finding({ quoted_text: "night-by-night", language: "cumulative" })] },
  { file: "04-tracked-two-authors.docx", findings: [finding({ quoted_text: "one hundred percent (100%)", language: "seventy percent (70%)" })] },
  { file: "05-move-from-to.docx", findings: [finding({ quoted_text: "indemnify Hotel against all claims", language: "indemnify Hotel against third-party claims" })] },
  { file: "06-header-footer-terms.docx", findings: [finding({ clause_type: "cutoff_date", quoted_text: "thirty (30) days", language: "sixty (60) days" })] },
  { file: "07-numbering-crossref.docx", findings: [finding({ quoted_text: "seventy percent (70%)", language: "eighty percent (80%)" })] },
  { file: "08-content-controls-fields.docx", findings: [finding({ quoted_text: "eighty percent (80%)", language: "seventy percent (70%)" })] },
  { file: "09-tracked-in-tables.docx", findings: [finding({ quoted_text: "seventy-five percent (75%)", language: "sixty percent (60%)" })] },
  { file: "10-word-run-splitting.docx", findings: [finding({ quoted_text: "eighty percent (80%)", language: "seventy percent (70%)" })] },
  {
    file: "11-repeated-phrases.docx",
    findings: [
      finding({
        clause_type: "cancellation",
        quoted_text: "Cancellation damages are eighty percent (80%) of anticipated room revenue.",
        language: "Cancellation damages are fifty percent (50%) of anticipated room revenue.",
      }),
    ],
  },
  {
    file: "12-tabs-breaks-symbols.docx",
    findings: [
      finding({ clause_type: "deposit", quoted_text: "Balance", language: "Final balance" }),
      finding({ quoted_text: "90 % of the block", language: "70% of the block" }),
    ],
  },
  {
    file: "13-nested-merged-tables.docx",
    findings: [finding({ clause_type: "cancellation", quoted_text: "Tier A fifty percent (50%)", language: "Tier A twenty-five percent (25%)" })],
  },
  { file: "14-revision-id-collisions.docx", findings: [finding({ quoted_text: "eighty percent (80%)", language: "seventy percent (70%)" })] },
  {
    file: "15-links-footnotes-comments.docx",
    findings: [
      finding({ clause_type: "mandatory_fees", quoted_text: "thirty-five dollars ($35.00) per room per night", language: "no resort fee" }),
      finding({ quoted_text: "eighty percent (80%)", language: "seventy percent (70%)" }),
    ],
  },
  {
    // Every corpus needs a document where nothing can be located, so the
    // Partial path is exercised rather than assumed.
    file: "01-clean-simple.docx",
    findings: [
      finding({ is_missing_clause: true, clause_type: "resale_credit", language: "Hotel shall credit resold rooms against attrition." }),
      finding({ quoted_text: "wording that is not anywhere in this contract", language: "replacement" }),
    ],
  },
];

export const readFixture = (file: string) => readFile(path.join(FIXTURE_DIR, file));
