import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { extractDocx } from "@/lib/docx";
import { generateRedline, type RevisionFinding } from "@/lib/redline-engine";
import { validateRedline } from "@/lib/redline-validation";
import { buildDocx, para, run } from "../helpers/docx-package";

/**
 * Fitting each change to what its proposal replaces, and leaving out wording
 * that isn't ready for the property.
 *
 * The first cases are the ones a Word check of the Monarch eval contract
 * turned up. Each reads the contract with every change accepted, because that
 * is where a duplicated or dangling phrase shows.
 */

const AUTHOR = "Jane Associate";

const finding = (over: Partial<RevisionFinding>): RevisionFinding => ({
  id: "finding-1",
  clause_type: "construction_renovation",
  severity: "high",
  is_missing_clause: false,
  quoted_text: null,
  language: "",
  finding_text: "Unfavourable to the client.",
  cd_standard: "CD position.",
  location_section: null,
  ...over,
});

async function redline(paragraph: string, f: RevisionFinding) {
  const originalBytes = await buildDocx(para(run(paragraph)));
  const result = await generateRedline({ originalDocxBytes: originalBytes, findings: [f], author: AUTHOR });
  const report = await validateRedline({ originalBytes, engineResult: result, author: AUTHOR });
  const xml = await (await JSZip.loadAsync(result.docxBytes)).file("word/document.xml")!.async("string");
  const accepted = (await extractDocx(result.docxBytes)).parts.find((p) => p.part === "document")!.text.trim();
  const count = (tag: string) => xml.match(new RegExp(`<${tag} [^>]*w:author="${AUTHOR}"`, "g"))?.length ?? 0;
  return { result, report, xml, accepted, deletions: count("w:del"), insertions: count("w:ins") };
}

describe("stretching a change over wording the proposal repeats", () => {
  it("covers a restated lead-in, even where the proposal rewords it", async () => {
    const paragraph =
      "If any renovation, construction, or capital project undertaken by the Hotel will materially interfere with the Group's ability to conduct its Event as contemplated by this Agreement, the Group may terminate this Agreement without penalty, liability, or further obligation, provided that the Group furnishes written notice of termination to the Hotel within ten (10) business days of receiving notice of the interfering project.";
    const proposal =
      "If any renovation, construction, or capital project undertaken by the Hotel will materially interfere with Group's Event, Group may terminate this Agreement without liability, provided Group furnishes written notice within thirty (30) days of receiving notice of the interfering project.";
    const { report, xml, accepted } = await redline(
      paragraph,
      finding({
        quoted_text:
          "the Group may terminate this Agreement without penalty, liability, or further obligation, provided that the Group furnishes written notice of termination to the Hotel within ten (10) business days of receiving notice of the interfering project.",
        language: proposal,
      })
    );
    expect(report.outcome).toBe("clean");
    expect(accepted).toBe(proposal);
    // The lead-in the proposal repeats stays as ordinary text.
    expect(xml).toContain(">If any renovation, construction, or capital project undertaken by the Hotel will materially interfere with </w:t>");
  });

  it("covers restated wording on both sides, and lets the sentence carry on", async () => {
    const paragraph =
      "The Hotel represents that all facilities and services described in the Event Proposal shall be available throughout the Event dates. In the event that circumstances beyond the Hotel's reasonable control necessitate the temporary or permanent reduction, limitation, or discontinuation of any facility or service by more than thirty percent (30%) of its stated capacity or scope, the Hotel shall immediately notify Group in writing and propose alternative facilities or services of substantially equal quality, at no additional cost to Group.";
    const { report, accepted, deletions, insertions } = await redline(
      paragraph,
      finding({
        clause_type: "facilities_services",
        quoted_text:
          "necessitate the temporary or permanent reduction, limitation, or discontinuation of any facility or service by more than thirty percent (30%) of its stated capacity or scope",
        language:
          "In the event that circumstances beyond the Hotel's reasonable control necessitate the temporary or permanent reduction, limitation, or discontinuation of any facility or service by more than twenty-five percent (25%) of its stated capacity or scope, the Hotel shall immediately notify Group in writing and propose alternative facilities or services.",
      })
    );
    expect(report.outcome).toBe("clean");
    expect([deletions, insertions]).toEqual([1, 1]);
    expect(accepted).toBe(paragraph.replace("thirty percent (30%)", "twenty-five percent (25%)"));
  });

  it("covers the rest of the sentence when the proposal repeats it to the end", async () => {
    const { report, accepted } = await redline(
      "Group shall pay the deposit within ten (10) days of signing. The balance is due on arrival.",
      finding({
        quoted_text: "Group shall pay the deposit within ten (10) days",
        language: "Group shall pay the deposit within thirty (30) days of signing.",
      })
    );
    expect(report.outcome).toBe("clean");
    expect(accepted).toBe("Group shall pay the deposit within thirty (30) days of signing. The balance is due on arrival.");
  });

  it("does not stretch back to an earlier copy of the proposal's opening words", async () => {
    const { report, accepted } = await redline(
      "Group shall pay the deposit on signing and Group shall pay the balance by May 1.",
      finding({ quoted_text: "Group shall pay the balance by May 1", language: "Group shall pay the balance by June 1" })
    );
    expect(report.outcome).toBe("clean");
    expect(accepted).toBe("Group shall pay the deposit on signing and Group shall pay the balance by June 1.");
  });

  it("leaves a quote that already covers its sentence as it is", async () => {
    const { report, accepted } = await redline(
      "Deposits are due on signing. The Hotel may cancel on thirty (30) days notice.",
      finding({
        quoted_text: "The Hotel may cancel on thirty (30) days notice.",
        language: "The Hotel may cancel on ninety (90) days written notice.",
      })
    );
    expect(report.outcome).toBe("clean");
    expect(accepted).toBe("Deposits are due on signing. The Hotel may cancel on ninety (90) days written notice.");
  });
});

describe("a proposal that ends mid-sentence", () => {
  it("is left out, with a reason, when the contract's sentence carries on", async () => {
    const paragraph =
      "The Hotel shall pay to Group a sales commission equal to nine percent (9%) of all room revenue actualized in connection with the Event, whether such rooms are booked as part of the blocked allocation or otherwise procured by Group members through independent channels. Commission shall be calculated on the gross room rate.";
    const { result, accepted, insertions, deletions } = await redline(
      paragraph,
      finding({
        clause_type: "commission",
        quoted_text:
          "The Hotel shall pay to Group a sales commission equal to nine percent (9%) of all room revenue actualized in connection with the Event",
        language:
          "All rates confirmed in this Agreement are commissionable at ten percent (10%) to ConferenceDirect, LLC, regardless of rate paid and including all rooms outside the block. Commission is non-cancelable and non-transferable.",
      })
    );
    expect(result.appliedCount).toBe(0);
    expect(result.unapplied.map((u) => u.reason)).toEqual(["ends_mid_sentence"]);
    expect(result.resolutions[0].applicability).toBe("blocked_wording");
    expect(result.resolutions[0].detail).toContain("whether such rooms are booked");
    expect([insertions, deletions]).toEqual([0, 0]);
    expect(accepted).toBe(paragraph);
  });

  it("is applied when the proposal is itself part of a sentence", async () => {
    const { result, accepted } = await redline(
      "The Hotel may cancel on thirty (30) days notice to Group.",
      finding({ quoted_text: "thirty (30) days", language: "ninety (90) days" })
    );
    expect(result.appliedCount).toBe(1);
    expect(accepted).toBe("The Hotel may cancel on ninety (90) days notice to Group.");
  });
});

describe("wording that isn't ready for the property", () => {
  const GRATUITY =
    "All gratuity collected by the Hotel on behalf of Group shall be distributed in full to the staff members who performed services for the Event.";

  it("leaves out wording with an unfilled blank", async () => {
    const { result, insertions } = await redline(
      GRATUITY,
      finding({
        clause_type: "gratuity_service_charge",
        quoted_text: GRATUITY,
        language:
          "State the gratuity percentage explicitly: '[X]% of the food and beverage total, plus applicable tax, will be added to Group's account as a gratuity.'",
      })
    );
    expect(result.appliedCount).toBe(0);
    expect(result.unapplied.map((u) => u.reason)).toEqual(["unfilled_blank"]);
    expect(result.resolutions[0].detail).toContain("[X]");
    expect(insertions).toBe(0);
  });

  it("leaves out wording that reads as an instruction", async () => {
    const { result } = await redline(
      GRATUITY,
      finding({
        clause_type: "gratuity_service_charge",
        quoted_text: GRATUITY,
        language: "Confirm that the gratuity is distributed in full to the staff who served the Event.",
      })
    );
    expect(result.unapplied.map((u) => u.reason)).toEqual(["not_contract_wording"]);
  });

  it("does not mistake contract wording that opens with such a word for an instruction", async () => {
    const { result, accepted } = await redline(
      "Taxes will be added to all charges.",
      finding({ quoted_text: "Taxes will be added to all charges.", language: "State and local taxes will be added to all charges." })
    );
    expect(result.appliedCount).toBe(1);
    expect(accepted).toBe("State and local taxes will be added to all charges.");
  });

  it("keeps a bracket the contract already has", async () => {
    const { result, accepted } = await redline(
      "The deposit is set out in Schedule [A] and is due on signing.",
      finding({
        quoted_text: "The deposit is set out in Schedule [A] and is due on signing.",
        language: "The deposit is set out in Schedule [A] and is due thirty (30) days after signing.",
      })
    );
    expect(result.appliedCount).toBe(1);
    expect(accepted).toBe("The deposit is set out in Schedule [A] and is due thirty (30) days after signing.");
  });

  it("leaves a missing clause with a blank out of the appendix", async () => {
    const { result, insertions } = await redline(
      "Group shall be relocated only with notice.",
      finding({
        clause_type: "walk_relocation",
        is_missing_clause: true,
        language: "Hotel will credit Group's master account $[X] for each night a guest is relocated.",
      })
    );
    expect(result.appliedCount).toBe(0);
    expect(result.unapplied.map((u) => u.reason)).toEqual(["unfilled_blank"]);
    expect(insertions).toBe(0);
  });
});
