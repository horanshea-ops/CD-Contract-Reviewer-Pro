import { describe, expect, it } from "vitest";
import { dryRunFindings, dryRunRedline, type DryRunRow } from "@/lib/exports/dry-run";
import { buildDocx, para, run } from "./helpers/docx-package";

/**
 * The export's check, run when the review screen loads.
 *
 * An associate used to decide every change and only then learn, at export,
 * that one had no place in the Word file. The wording here follows two stored
 * reviews: a quote the model shortened with "...", and the single word
 * "Office", which the contract holds many times.
 */

const CUTOFF = "We ask that all room requests be received thirty days prior to arrival. After that date, prevailing hotel rates shall apply.";
const OFFICES = "The sales office confirms each booking. The front office holds the keys.";
const DAMAGES = "Group shall be liable for eighty percent (80%) of the group rate.";
const contract = () => buildDocx(para(run(CUTOFF)) + para(run(OFFICES)) + para(run(DAMAGES)));

let next = 0;
const row = (over: Partial<DryRunRow> = {}): DryRunRow => ({
  id: `f${next++}`,
  clause_type: "attrition",
  severity: "medium",
  category: "business",
  is_missing_clause: false,
  quoted_text: null,
  location_section: null,
  finding_text: "Unfavourable to the client.",
  cd_standard: "CD position.",
  proposed_language: "",
  current_action: null,
  ...over,
});

const SWAP = { quoted_text: "eighty percent (80%)", proposed_language: "seventy percent (70%)" };

describe("which changes the check covers", () => {
  it("takes every business change with wording that isn't dismissed or sent by email", () => {
    const rows = [
      row({ id: "undecided", ...SWAP }),
      row({ id: "accepted", ...SWAP, current_action: { action: "accept", edited_language: null } }),
      row({ id: "dismissed", ...SWAP, current_action: { action: "dismiss", edited_language: null } }),
      row({ id: "emailed", ...SWAP, current_action: { action: "accept", edited_language: null, by_email: true } }),
      row({ id: "legal", ...SWAP, category: "legal" }),
      row({ id: "no-change", ...SWAP, proposed_language: "No change needed — retain as drafted." }),
    ];

    expect(dryRunFindings(rows).map((f) => f.id)).toEqual(["undecided", "accepted"]);
  });

  it("uses the associate's wording, and the place they picked", () => {
    const [f] = dryRunFindings([
      row({
        ...SWAP,
        current_action: { action: "edit", edited_language: "sixty percent (60%)", edited_quote: "eighty percent", quote_context: "liable for " },
      }),
    ]);

    expect(f).toMatchObject({ language: "sixty percent (60%)", quoted_text: "eighty percent", quote_context: "liable for " });
  });

  it("takes them in the order the export does, most severe first", () => {
    const rows = [row({ id: "low", severity: "low", ...SWAP }), row({ id: "high", severity: "high", ...SWAP })];
    expect(dryRunFindings(rows).map((f) => f.id)).toEqual(["high", "low"]);
  });
});

describe("what each card is told", () => {
  async function check(rows: DryRunRow[]) {
    return dryRunRedline(await contract(), dryRunFindings(rows));
  }

  it("says a change has its place", async () => {
    const { verdicts, fallbackReason } = await check([row({ id: "ok", ...SWAP })]);

    expect(fallbackReason).toBeNull();
    expect(verdicts.get("ok")).toEqual({
      placed: true,
      reason: null,
      detail: "Editable in place.",
      conflictsWith: null,
      places: null,
      alsoStrikes: null,
      redlineLanguage: null,
    });
  });

  it("says a shortened quote wasn't found", async () => {
    const { verdicts } = await check([
      row({
        id: "cutoff",
        quoted_text: "We ask that all room requests be received... prevailing hotel rates shall apply.",
        proposed_language: "The cutoff date is twenty-one days prior to arrival.",
      }),
    ]);

    expect(verdicts.get("cutoff")).toMatchObject({ placed: false, reason: "not_located", places: null });
  });

  it("lists each place a one-word quote was found", async () => {
    const { verdicts } = await check([row({ id: "office", quoted_text: "office", proposed_language: "Office" })]);
    const verdict = verdicts.get("office")!;

    expect(verdict).toMatchObject({ placed: false, reason: "ambiguous_quote" });
    expect(verdict.places).toHaveLength(2);
    expect(verdict.places![1].before.endsWith("The front ")).toBe(true);
  });

  it("places it once the associate has picked one", async () => {
    const { verdicts } = await check([
      row({
        id: "office",
        quoted_text: "office",
        proposed_language: "Office",
        current_action: { action: "accept", edited_language: null, edited_quote: "office", quote_context: "The front " },
      }),
    ]);

    expect(verdicts.get("office")).toMatchObject({ placed: true, reason: null });
  });

  it("names the change an overlapping one runs into, before either is accepted", async () => {
    const { verdicts } = await check([
      row({ id: "first", severity: "high", ...SWAP }),
      row({ id: "second", quoted_text: "for eighty percent (80%) of", proposed_language: "for sixty percent (60%) of" }),
    ]);

    expect(verdicts.get("first")).toMatchObject({ placed: true });
    expect(verdicts.get("second")).toMatchObject({ placed: false, reason: "overlaps_another_change", conflictsWith: "first" });
  });

  it("stops naming it once the other is dismissed", async () => {
    const { verdicts } = await check([
      row({ id: "first", severity: "high", ...SWAP, current_action: { action: "dismiss", edited_language: null } }),
      row({ id: "second", quoted_text: "for eighty percent (80%) of", proposed_language: "for sixty percent (60%) of" }),
    ]);

    expect(verdicts.has("first")).toBe(false);
    expect(verdicts.get("second")).toMatchObject({ placed: true });
  });

  it("says the whole file would fall back when the engine can't run", async () => {
    const { verdicts, fallbackReason } = await dryRunRedline(new TextEncoder().encode("not a Word file"), dryRunFindings([row(SWAP)]));

    expect(verdicts.size).toBe(0);
    expect(fallbackReason).toMatch(/^The tracked changes could not be generated: /);
  });
});
