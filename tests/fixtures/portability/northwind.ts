import type { Finding } from "@/lib/anthropic";
import type { OrgProfile } from "@/lib/org";
import type { StandardEntry } from "@/lib/standards/types";

/**
 * An invented client with its own standards library, for the §2.0.3
 * portability test. None of its clause types appear in the hotel library, so
 * anything in the pipeline that assumes CD's taxonomy fails against it.
 */

export const NORTHWIND_ORG: OrgProfile = {
  name: "Northwind Events",
  shortName: "NWE",
  description: "a corporate travel agency",
};

export const NORTHWIND_VERSION = "northwind-test-v1";

const entry = (over: Pick<StandardEntry, "clause_type" | "position" | "fallback_language">): StandardEntry => ({
  segment: "default",
  walk_away_condition: "",
  severity_default: "medium",
  version: NORTHWIND_VERSION,
  provenance: "industry_default",
  ...over,
});

export const NORTHWIND_STANDARDS: StandardEntry[] = [
  entry({
    clause_type: "performance_shortfall",
    position: "Shortfall is measured across the whole commitment, never period by period.",
    fallback_language: "Shortfall shall be measured on a cumulative basis.",
  }),
  entry({
    clause_type: "damages_formula",
    position: "Damages for a shortfall never exceed sixty percent of the committed rate.",
    fallback_language: "Client shall be liable for sixty percent (60%) of the committed rate.",
  }),
  entry({
    clause_type: "dispute_forum",
    position: "Disputes are heard in the client's home jurisdiction.",
    fallback_language: "Any dispute shall be resolved in the courts of the Client's principal place of business.",
  }),
  entry({
    clause_type: "payment_terms",
    position: "Invoices are payable thirty days after receipt.",
    fallback_language: "Invoices are payable within thirty (30) days of receipt.",
  }),
];

/**
 * What the model returns for tests/fixtures/01-clean-simple.docx. Two quotes
 * are verbatim from that contract and one clause is missing from it.
 */
export const NORTHWIND_FINDINGS: Finding[] = [
  {
    clause_type: "performance_shortfall",
    is_missing_clause: false,
    severity: "medium",
    location_section: "2. Attrition",
    quoted_text: "night-by-night basis",
    exposure_amount: null,
    exposure_basis: null,
    finding_text: "Shortfall is measured per night rather than across the commitment.",
    cd_standard: "Shortfall is measured across the whole commitment.",
    proposed_language: "cumulative basis",
    model_confidence: "high",
  },
  {
    clause_type: "damages_formula",
    is_missing_clause: false,
    severity: "high",
    location_section: "2. Attrition",
    quoted_text: "eighty percent (80%)",
    exposure_amount: null,
    exposure_basis: null,
    finding_text: "Damages rate exceeds sixty percent.",
    cd_standard: "Damages never exceed sixty percent.",
    proposed_language: "sixty percent (60%)",
    model_confidence: "high",
  },
  {
    clause_type: "dispute_forum",
    is_missing_clause: true,
    severity: "low",
    location_section: null,
    quoted_text: null,
    exposure_amount: null,
    exposure_basis: null,
    finding_text: "The contract names no forum for disputes.",
    cd_standard: "Disputes are heard in the client's home jurisdiction.",
    proposed_language: "Any dispute shall be resolved in the courts of the Client's principal place of business.",
    model_confidence: "medium",
  },
];
