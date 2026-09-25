import { describe, expect, it } from "vitest";
import { extractDocx } from "@/lib/docx";
import { generateRedline, type RevisionFinding } from "@/lib/redline-engine";
import { dropRestated, rewritesExistingWording, struckSentences } from "@/lib/redline-engine/restated";
import { validateRedline } from "@/lib/redline-validation";
import { buildDocx, para, run } from "../helpers/docx-package";

/**
 * Wording a proposal repeats from elsewhere in the contract.
 *
 * Each case is a shape a real contract produced. Accepting the changes printed
 * a sentence twice, or left a rewritten clause beside the one it rewrote. The
 * contract wording here is invented.
 */

const AUTHOR = "Jane Associate";

const finding = (over: Partial<RevisionFinding>): RevisionFinding => ({
  id: "finding-1",
  clause_type: "master_account_billing",
  severity: "medium",
  is_missing_clause: false,
  quoted_text: null,
  language: "",
  finding_text: "Unfavourable to the client.",
  cd_standard: "CD position.",
  location_section: null,
  ...over,
});

async function redline(paragraphs: string[], findings: RevisionFinding[]) {
  const originalBytes = await buildDocx(paragraphs.map((p) => para(run(p))).join(""));
  const result = await generateRedline({ originalDocxBytes: originalBytes, findings, author: AUTHOR });
  const report = await validateRedline({ originalBytes, engineResult: result, author: AUTHOR });
  const accepted = (await extractDocx(result.docxBytes)).parts.find((p) => p.part === "document")!.text;
  const count = (s: string) => accepted.split(s).length - 1;
  return { result, report, accepted, count };
}

const CREDIT = "We will send you a credit application on request no later than six months before your meeting.";
const DEPOSITS = `No deposit is due at signing. ${CREDIT}`;
const LATE_FEE = "Unpaid balances accrue a late charge of one and one half percent (1.5%) per month.";

describe("dropRestated", () => {
  it("drops a sentence the contract already has outside the change", () => {
    const out = dropRestated(`Unpaid balances accrue a late charge of one percent (1%) per month. ${CREDIT}`, `${DEPOSITS}\n${LATE_FEE}`, [
      LATE_FEE,
    ]);
    expect(out.language).toBe("Unpaid balances accrue a late charge of one percent (1%) per month.");
    expect(out.dropped).toEqual([CREDIT]);
  });

  it("keeps a sentence another finding strikes, so the contract doesn't lose it", () => {
    const out = dropRestated(`Something new happens here in this clause today. ${CREDIT}`, DEPOSITS, [CREDIT]);
    expect(out.dropped).toEqual([]);
  });

  it("keeps a proposal made only of restated sentences", () => {
    const out = dropRestated(CREDIT, DEPOSITS, []);
    expect(out).toEqual({ language: CREDIT, dropped: [], reworded: [] });
  });

  it("ignores short sentences, which recur in any contract", () => {
    const out = dropRestated("Late fees change to 1% monthly. No deposit is due at signing.", DEPOSITS, []);
    expect(out.dropped).toEqual([]);
  });
});

describe("dropRestated with reworded sentences", () => {
  const RELEASE = "On the cutoff date we will return any unreserved rooms in the block to general inventory for resale.";
  const AFTER = "Reservations received after the cutoff date will be accepted on a space and rate available basis.";
  const CONTRACT = `The cutoff date is thirty days before arrival. ${RELEASE}\n${AFTER}`;

  it("leaves out a rewrite of a sentence the finding doesn't quote", () => {
    const reworded =
      "On the cutoff date, after consultation with you, we will return any unreserved rooms in the block to general inventory for resale.";
    const out = dropRestated(`${reworded} Reservations received after the cutoff date will be accepted at the group rate.`, CONTRACT, [
      AFTER,
    ]);
    expect(out.reworded).toEqual([reworded]);
    expect(out.language).toBe("Reservations received after the cutoff date will be accepted at the group rate.");
  });

  it("keeps a rewrite of the wording the finding quotes, which is the change itself", () => {
    const out = dropRestated("Reservations received after the cutoff date will be accepted at the group rate while rooms remain.", CONTRACT, [
      AFTER,
    ]);
    expect(out).toMatchObject({ dropped: [], reworded: [] });
  });

  it("recognises quoted wording behind a bullet glyph or tab the contract carries", () => {
    const bulleted = `\uF0B7\t${AFTER}`;
    const out = dropRestated(
      `Reservations received after the cutoff date will be accepted at the group rate. ${RELEASE.replace("for resale", "for resale after consultation")}`,
      `${bulleted}\n${RELEASE}`,
      [AFTER]
    );
    expect(out.reworded).toHaveLength(1);
    expect(out.language).toBe("Reservations received after the cutoff date will be accepted at the group rate.");
  });

  it("keeps a new sentence that only shares a phrase with the contract", () => {
    const out = dropRestated(
      `We will return any unreserved rooms promptly. Either party may cancel without liability if a named storm is forecast to reach the Hotel within three days.`,
      CONTRACT,
      [AFTER]
    );
    expect(out.reworded).toEqual([]);
  });
});

describe("rewritesExistingWording", () => {
  const ATTRITION =
    "You agree that reservations will be made for and that you will use at least 2,280 room nights over the dates of the Room Block.";

  it("spots a proposal that opens with twelve words of existing wording", () => {
    expect(rewritesExistingWording(ATTRITION.replace("2,280", "1,995"), ATTRITION)).toBe(true);
  });

  it("lets a genuinely new clause through, even with a common opening", () => {
    const contract = "Notwithstanding anything to the contrary in this Agreement, the Hotel may require prepayment.";
    const named = "Notwithstanding anything to the contrary in this Agreement, either party may cancel for a named storm.";
    expect(rewritesExistingWording(named, contract)).toBe(false);
  });
});

describe("struckSentences", () => {
  it("lists quoted sentences the proposal doesn't keep", () => {
    const quote = `${LATE_FEE} ${CREDIT}`;
    expect(struckSentences([{ quoted_text: quote, language: CREDIT }])).toEqual([LATE_FEE]);
  });
});

describe("the engine with restated wording", () => {
  it("doesn't print a sentence twice when the proposal restates one from another paragraph", async () => {
    const { result, report, count } = await redline(
      [DEPOSITS, LATE_FEE],
      [
        finding({
          quoted_text: LATE_FEE,
          language: `Unpaid balances accrue a late charge of one percent (1%) per month. ${CREDIT}`,
        }),
      ]
    );
    expect(result.appliedCount).toBe(1);
    expect(report.outcome).toBe("clean");
    expect(count(CREDIT)).toBe(1);
    expect(result.resolutions[0].detail).toContain("Leaves out a sentence the contract already has.");
  });

  it("covers restated sentences elsewhere in the quote's paragraph, and strikes only what changes", async () => {
    const paragraph =
      "Contractors must be approved by us before performing any services at the Resort. Entertainment in areas open to other guests must be provided through us. You are responsible for all acts and omissions of your contractors.";
    const { report, accepted, result } = await redline(
      [paragraph],
      [
        finding({
          clause_type: "exclusivity_vendors",
          quoted_text: "Entertainment in areas open to other guests must be provided through us.",
          language:
            "Contractors must be approved by us before performing any services at the Resort. You are responsible for all acts and omissions of your contractors.",
        }),
      ]
    );
    expect(report.outcome).toBe("clean");
    expect(accepted.trim()).toBe(
      "Contractors must be approved by us before performing any services at the Resort. You are responsible for all acts and omissions of your contractors."
    );
    expect(result.resolutions[0].detail).not.toContain("Leaves out");
  });

  it("doesn't leave two versions of a sentence the proposal rewords without quoting it", async () => {
    const release = "On the cutoff date we will return any unreserved rooms in the block to general inventory for resale.";
    const after = "Reservations received after the cutoff date will be accepted on a space and rate available basis.";
    const { result, report, accepted } = await redline(
      [`The cutoff date is thirty days before arrival. ${release}`, after],
      [
        finding({
          clause_type: "cutoff_date",
          quoted_text: after,
          language:
            "On the cutoff date, after consultation with you, we will return any unreserved rooms in the block to general inventory for resale. Reservations received after the cutoff date will be accepted at the group rate.",
        }),
      ]
    );
    expect(result.appliedCount).toBe(1);
    expect(report.outcome).toBe("clean");
    expect(accepted.split("On the cutoff date").length - 1).toBe(1);
    expect(accepted).toContain("Reservations received after the cutoff date will be accepted at the group rate.");
    expect(result.resolutions[0].detail).toContain(`Leaves out a rewrite of wording it doesn't quote: "On the cutoff date, after consultation with you…"`);
  });

  it("leaves out an appended clause's restated sentence", async () => {
    const SMALL = "An additional charge of fifty dollars applies to each meal function under twenty guests.";
    const { count, report } = await redline(
      [`Food and beverage carries a service charge. ${SMALL}`],
      [
        finding({
          clause_type: "banquet_service_levels",
          is_missing_clause: true,
          language: `At every plated meal we will staff one server for each twenty guests at minimum. ${SMALL}`,
        }),
      ]
    );
    expect(report.outcome).toBe("clean");
    expect(count(SMALL)).toBe(1);
  });
});

describe("findings that don't say where they belong", () => {
  const ATTRITION =
    "You agree that reservations will be made for and that you will use at least 2,280 room nights over the dates of the Room Block. Damages are eighty percent (80%) of the rate.";

  it("leaves out a quote-less rewrite of an existing clause instead of appending a second version", async () => {
    const { result, count } = await redline(
      [ATTRITION],
      [
        finding({
          clause_type: "attrition",
          language:
            "You agree that reservations will be made for and that you will use at least 2,280 room nights over the dates of the Room Block. Damages are seventy percent (70%) of the rate.",
        }),
      ]
    );
    expect(result.appliedCount).toBe(0);
    expect(result.unapplied).toMatchObject([{ clause_type: "attrition", reason: "unquoted_rewrite" }]);
    expect(count("You agree that reservations")).toBe(1);
  });

  it("changes a finding marked missing in place when it quotes the contract", async () => {
    const clause = "You may not assign this Agreement without our consent in our sole discretion.";
    const { result, accepted } = await redline(
      [clause],
      [
        finding({
          clause_type: "assignment_subcontracting",
          is_missing_clause: true,
          quoted_text: clause,
          language: "You may not assign this Agreement without our consent, which we will not unreasonably withhold.",
        }),
      ]
    );
    expect(result.appliedCount).toBe(1);
    expect(accepted.trim()).toBe("You may not assign this Agreement without our consent, which we will not unreasonably withhold.");
  });

  it("still appends a genuinely missing clause", async () => {
    const { result, accepted } = await redline(
      ["The Hotel will hold the rooms listed above."],
      [
        finding({
          clause_type: "named_storm",
          is_missing_clause: true,
          language: "Either party may cancel without liability if a named storm is forecast to reach the Hotel.",
        }),
      ]
    );
    expect(result.appliedCount).toBe(1);
    expect(accepted).toContain("Either party may cancel without liability if a named storm");
  });
});
