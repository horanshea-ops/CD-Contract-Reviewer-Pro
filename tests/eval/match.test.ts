import { describe, it, expect } from "vitest";
import type { Finding } from "@/lib/anthropic";
import type { KeyItem } from "@/lib/eval/types";
import {
  matchDocument,
  scoreCandidate,
  locateFinding,
  normalizeClauseType,
  clauseTypesAgree,
  bestOverlap,
} from "@/lib/eval/match";

/**
 * A mis-pairing here does not throw and does not look wrong — it moves one rate
 * down and another up, and the report reads exactly as it would if the model had
 * made that mistake. So the rules are tested as rules, not sampled.
 */

const CONTRACT = [
  "# 2. Attrition",
  "Attrition is measured on a night-by-night basis. The threshold is ninety percent (90%).",
  "# 3. Cancellation",
  "Damages are a percentage of gross room revenue. The Hotel keeps any resale proceeds.",
  "# 4. Cutoff",
  "Reservations close forty-five (45) days prior to arrival.",
].join("\n");

const parts = [{ part: "document", text: CONTRACT }];

const spanOf = (needle: string) => {
  const start = CONTRACT.indexOf(needle);
  if (start === -1) throw new Error(`Test fixture does not contain ${JSON.stringify(needle)}`);
  return { part: "document", start, end: start + needle.length };
};

function keyItem(over: Partial<KeyItem> = {}): KeyItem {
  return {
    id: "k1",
    contract: "c.docx",
    kind: "present",
    clause_type: "attrition",
    severity: "high",
    anchors: [spanOf("The threshold is ninety percent (90%).")],
    anchor_texts: ["The threshold is ninety percent (90%)."],
    expected_language: [],
    exposure: { mode: "unspecified" },
    rationale: "",
    ...over,
  };
}

function finding(over: Partial<Finding> = {}): Finding {
  return {
    clause_type: "attrition",
    is_missing_clause: false,
    severity: "high",
    location_section: null,
    quoted_text: "The threshold is ninety percent (90%).",
    exposure_amount: null,
    exposure_basis: null,
    finding_text: "Threshold too high.",
    cd_standard: "70%.",
    proposed_language: "seventy percent (70%)",
    model_confidence: "high",
    ...over,
  };
}

describe("normalizeClauseType", () => {
  it("strips the decoration models put around a clause name", () => {
    expect(normalizeClauseType("Attrition Clause")).toBe("attrition");
    expect(normalizeClauseType("the_cancellation_provision")).toBe("cancellation");
    expect(normalizeClauseType("Section Force Majeure")).toBe("force_majeure");
    expect(normalizeClauseType("FORCE MAJEURE")).toBe("force_majeure");
  });

  it("maps the names the model actually uses onto library clause types", () => {
    expect(normalizeClauseType("Resort Fees")).toBe("mandatory_fees");
    expect(normalizeClauseType("food and beverage minimum")).toBe("fb_minimum");
    expect(normalizeClauseType("Cut-Off Date")).toBe("cutoff_date");
    expect(clauseTypesAgree("walk_relocation", "Relocation")).toBe(true);
  });

  it("refuses to guess at a name it has never seen", () => {
    // Similarity matching would pair these and report the pairing as fact.
    expect(clauseTypesAgree("attrition", "cancellation")).toBe(false);
    expect(clauseTypesAgree("attrition", "attrit")).toBe(false);
  });
});

describe("locateFinding", () => {
  it("locates a verbatim quote", () => {
    const location = locateFinding(parts, finding());
    expect(location.status).toBe("located");
    if (location.status === "located") expect(location.resolution).toBe("exact");
  });

  it("reports a quote that is not in the document at all", () => {
    const location = locateFinding(parts, finding({ quoted_text: "wording invented out of nothing whatsoever" }));
    expect(location.status).toBe("unlocatable");
  });

  it("reports a quote that appears in more than one place", () => {
    const repeated = [{ part: "document", text: "Group is liable for 80%. Group is liable for 80%." }];
    const location = locateFinding(repeated, finding({ quoted_text: "Group is liable for 80%" }));
    expect(location.status).toBe("ambiguous");
  });

  it("reports a missing-clause finding as quoting nothing, which is correct for one", () => {
    expect(locateFinding(parts, finding({ quoted_text: null, is_missing_clause: true })).status).toBe("no_quote");
  });
});

describe("scoreCandidate", () => {
  const located = locateFinding(parts, finding());

  it("scores a span match far above a clause-type match", () => {
    const span = scoreCandidate(keyItem(), finding(), located)!;
    const byType = scoreCandidate(
      keyItem({ kind: "absent", anchors: [], anchor_texts: [] }),
      finding({ is_missing_clause: true, quoted_text: null }),
      { status: "no_quote" }
    )!;
    expect(span.basis).toBe("span");
    expect(byType.basis).toBe("clause_type");
    expect(span.weight).toBeGreaterThan(byType.weight * 5);
  });

  it("refuses a pair whose spans do not overlap, even when the clause types agree", () => {
    // Both sides named a place in the document. Different places means different
    // issues, and a shared clause type does not override that.
    const elsewhere = keyItem({ anchors: [spanOf("Reservations close forty-five (45) days prior to arrival.")] });
    expect(scoreCandidate(elsewhere, finding(), located)).toBeNull();
  });

  it("falls back to clause type when the finding's quote resolves nowhere", () => {
    const nowhere = locateFinding(parts, finding({ quoted_text: "not in this document anywhere at all" }));
    expect(scoreCandidate(keyItem(), finding(), nowhere)!.basis).toBe("clause_type");
  });

  it("pairs a present clause the model called missing, so it grades as a presence error", () => {
    const called_missing = finding({ is_missing_clause: true, quoted_text: null });
    const candidate = scoreCandidate(keyItem(), called_missing, { status: "no_quote" });
    expect(candidate).not.toBeNull();
    expect(candidate!.basis).toBe("clause_type");
  });

  it("prefers the pair whose attributes also agree, all else equal", () => {
    const agrees = scoreCandidate(keyItem(), finding(), located)!;
    const disagrees = scoreCandidate(keyItem(), finding({ severity: "note", clause_type: "cancellation" }), located)!;
    expect(agrees.weight).toBeGreaterThan(disagrees.weight);
  });
});

describe("bestOverlap", () => {
  it("measures how much of the anchor the finding covers", () => {
    const anchor = { part: "document", start: 10, end: 20 };
    expect(bestOverlap([anchor], { part: "document", start: 10, end: 20 })).toBe(1);
    expect(bestOverlap([anchor], { part: "document", start: 15, end: 20 })).toBe(0.5);
    expect(bestOverlap([anchor], { part: "document", start: 0, end: 100 })).toBe(1);
    expect(bestOverlap([anchor], { part: "document", start: 20, end: 30 })).toBe(0);
    expect(bestOverlap([anchor], { part: "footer1", start: 10, end: 20 })).toBe(0);
  });

  it("takes the best of several anchors, so a restated term still counts", () => {
    const anchors = [
      { part: "document", start: 10, end: 20 },
      { part: "footer1", start: 0, end: 10 },
    ];
    expect(bestOverlap(anchors, { part: "footer1", start: 0, end: 10 })).toBe(1);
  });
});

describe("matchDocument", () => {
  const attritionKey = keyItem({ id: "k-attrition" });
  const cancellationKey = keyItem({
    id: "k-cancellation",
    clause_type: "cancellation",
    anchors: [spanOf("Damages are a percentage of gross room revenue.")],
    anchor_texts: ["Damages are a percentage of gross room revenue."],
  });

  it("pairs each finding with the key item it points at", () => {
    const findings = [
      finding({ clause_type: "cancellation", quoted_text: "Damages are a percentage of gross room revenue." }),
      finding(),
    ];
    const result = matchDocument([attritionKey, cancellationKey], findings, parts);

    expect(result.pairs).toHaveLength(2);
    expect(result.pairs.map((p) => [p.keyIndex, p.findingIndex])).toEqual([
      [0, 1],
      [1, 0],
    ]);
    expect(result.pairs.every((p) => p.basis === "span")).toBe(true);
    expect(result.unmatchedKey).toEqual([]);
    expect(result.unmatchedFindings).toEqual([]);
  });

  it("never uses one finding twice", () => {
    const findings = [finding()];
    const result = matchDocument([attritionKey, keyItem({ id: "k-attrition-2" })], findings, parts);
    expect(result.pairs).toHaveLength(1);
    expect(result.unmatchedKey).toHaveLength(1);
  });

  it("gives the same pairs however the inputs are ordered", () => {
    const findings = [
      finding({ clause_type: "cancellation", quoted_text: "Damages are a percentage of gross room revenue." }),
      finding(),
      finding({ clause_type: "cutoff_date", quoted_text: "Reservations close forty-five (45) days prior to arrival." }),
    ];
    const cutoffKey = keyItem({
      id: "k-cutoff",
      clause_type: "cutoff_date",
      anchors: [spanOf("Reservations close forty-five (45) days prior to arrival.")],
      anchor_texts: ["Reservations close forty-five (45) days prior to arrival."],
    });
    const keys = [attritionKey, cancellationKey, cutoffKey];

    const forwards = matchDocument(keys, findings, parts);
    const backwards = matchDocument([...keys].reverse(), [...findings].reverse(), parts);

    // Compare by identity, not by array position, since reversing renumbers both.
    const asContent = (
      result: ReturnType<typeof matchDocument>,
      k: KeyItem[],
      f: Finding[]
    ) => result.pairs.map((p) => `${k[p.keyIndex].id}->${f[p.findingIndex].clause_type}`).sort();

    expect(asContent(backwards, [...keys].reverse(), [...findings].reverse())).toEqual(
      asContent(forwards, keys, findings)
    );
  });

  it("beats greedy when the obvious pair is the wrong one", () => {
    // The broad finding covers both anchors, so a greedy pass hands it the
    // attrition item and leaves the narrow attrition-only finding unpaired.
    // Standing back pairs both.
    const broad = finding({
      clause_type: "cancellation",
      quoted_text:
        "Attrition is measured on a night-by-night basis. The threshold is ninety percent (90%).\n# 3. Cancellation\nDamages are a percentage of gross room revenue.",
    });
    const narrow = finding();

    const result = matchDocument([attritionKey, cancellationKey], [broad, narrow], parts);
    expect(result.pairs).toHaveLength(2);
    expect(result.unmatchedFindings).toEqual([]);
  });

  it("names a key item that a matched finding swallowed, rather than calling it unnoticed", () => {
    const broad = finding({
      quoted_text:
        "Attrition is measured on a night-by-night basis. The threshold is ninety percent (90%).\n# 3. Cancellation\nDamages are a percentage of gross room revenue.",
    });
    const result = matchDocument([attritionKey, cancellationKey], [broad], parts);

    expect(result.pairs).toHaveLength(1);
    expect(result.unmatchedKey).toEqual([{ keyIndex: 1, conflatedWith: 0 }]);
  });

  it("names a second finding on one issue as a duplicate, not an invention", () => {
    const first = finding();
    const second = finding({ finding_text: "Also too high.", quoted_text: "ninety percent (90%)" });
    const result = matchDocument([attritionKey], [first, second], parts);

    expect(result.pairs).toHaveLength(1);
    expect(result.unmatchedFindings).toEqual([{ findingIndex: 1, duplicateOf: 0 }]);
  });

  it("leaves a finding about nothing in the key unpaired and unattributed", () => {
    const invented = finding({
      clause_type: "named_storm",
      quoted_text: "wording that appears nowhere in this contract",
    });
    const result = matchDocument([attritionKey], [invented], parts);

    expect(result.pairs).toEqual([]);
    expect(result.unmatchedFindings).toEqual([{ findingIndex: 0, duplicateOf: null }]);
    expect(result.locations[0].status).toBe("unlocatable");
  });

  it("still pairs a finding whose quote was invented, and records the quote as unlocatable", () => {
    // The model found the right clause and fabricated the wording. That is a
    // quote failure on a real pair, not a miss plus a false positive.
    const fabricated = finding({ quoted_text: "a sentence this contract does not contain" });
    const result = matchDocument([attritionKey], [fabricated], parts);

    expect(result.pairs).toHaveLength(1);
    expect(result.pairs[0].basis).toBe("clause_type");
    expect(result.locations[0].status).toBe("unlocatable");
  });

  it("handles a document with no findings, and findings with no key", () => {
    expect(matchDocument([attritionKey], [], parts).unmatchedKey).toEqual([{ keyIndex: 0, conflatedWith: null }]);
    expect(matchDocument([], [finding()], parts).unmatchedFindings).toEqual([
      { findingIndex: 0, duplicateOf: null },
    ]);
    expect(matchDocument([], [], parts).pairs).toEqual([]);
  });
});
