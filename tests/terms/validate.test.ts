import { describe, expect, it } from "vitest";
import { HOTEL_TERM_CATALOG } from "@/lib/terms/catalog";
import { validateTerms } from "@/lib/terms/validate";

const TEXT = [
  "This Group Sales Agreement is for the event to be held April 12-16, 2027.",
  "Hotel will hold a block of 340 guest rooms on the peak night at a group rate of $289.00 per room, per night.",
  "Group shall be deemed in attrition if actual occupancy falls below the attrition threshold of ninety percent (90%) on any night.",
  "Attrition is measured on a night-by-night basis.",
  "Reservations must be received no later than thirty (30) days prior to arrival.",
  "The Hotel shall provide one (1) complimentary room per seventy-five (75) paid room nights occupied.",
  "Liquidated damages apply to a cancellation at any time after signature, with no liability-free window.",
  "Group shall receive no credit toward its block commitment for nights on which the Hotel sells out.",
  "A monthly finance charge of 1.5% shall accrue on the unpaid balance.",
].join("\n\n");

const parts = [{ part: "document", text: TEXT }];

const entry = (term_key: string, value: unknown, quoted_text: string, extra: Record<string, unknown> = {}) => ({
  term_key,
  value,
  quoted_text,
  source_section: null,
  confidence: "high",
  ...extra,
});

const run = (...entries: unknown[]) => validateTerms(entries, HOTEL_TERM_CATALOG, parts);
const only = (result: ReturnType<typeof run>) => {
  expect(result.stated).toHaveLength(1);
  return result.stated[0];
};

describe("normalising values to their catalog type", () => {
  it("stores a percentage given as written as a fraction", () => {
    const term = only(run(entry("attrition.threshold", 90, "attrition threshold of ninety percent (90%)")));
    expect(term.value).toBe(0.9);
    expect(term.unit).toBe("pct");
  });

  it("reads a dollar figure sent as a string", () => {
    expect(only(run(entry("deal.group_rate_usd", "$289.00", "a group rate of $289.00 per room"))).value).toBe(289);
  });

  it("keeps a fractional percentage exact", () => {
    const term = only(run(entry("master_account_billing.finance_charge_monthly_pct", 1.5, "A monthly finance charge of 1.5% shall accrue")));
    expect(term.value).toBeCloseTo(0.015, 12);
    expect(term.verification).toBe("verified");
  });

  it("normalises enum spelling, and accepts other", () => {
    expect(only(run(entry("attrition.basis", "Night-by-Night", "measured on a night-by-night basis"))).value).toBe("night_by_night");
    expect(only(run(entry("attrition.basis", "other", "measured on a night-by-night basis"))).value).toBe("other");
  });

  it("accepts a boolean sent as a string", () => {
    expect(only(run(entry("attrition.high_occupancy_credit", "false", "Group shall receive no credit toward its block commitment"))).value).toBe(false);
  });

  it("normalises every schedule tier", () => {
    const term = only(
      run(
        entry(
          "cancellation.schedule",
          [
            { label: "365 days or more", days_prior_min: 365, days_prior_max: null, pct: 25 },
            { label: "30 days or fewer", days_prior_min: 0, days_prior_max: 30, pct: 100 },
          ],
          "Liquidated damages apply to a cancellation at any time after signature"
        )
      )
    );
    expect(term.value).toEqual([
      { label: "365 days or more", days_prior_min: 365, days_prior_max: null, pct: 0.25 },
      { label: "30 days or fewer", days_prior_min: 0, days_prior_max: 30, pct: 1 },
    ]);
  });
});

describe("rejecting what cannot be stored", () => {
  const reasons = (...entries: unknown[]) => run(...entries).rejected.map((r) => r.reason);

  it("rejects a key the catalog does not have", () => {
    expect(reasons(entry("attrition.nonsense", 1, "ninety percent (90%)"))[0]).toMatch(/not in catalog hotel-v1/);
  });

  it("rejects an entry with no quote", () => {
    expect(reasons(entry("attrition.threshold", 90, "  "))[0]).toMatch(/quotes no wording/);
  });

  it("rejects a percentage outside 0-100 and a negative duration", () => {
    expect(reasons(entry("attrition.threshold", 150, "ninety percent (90%)"))[0]).toMatch(/outside 0–100/);
    expect(reasons(entry("cutoff_date.days_prior", -5, "thirty (30) days"))[0]).toMatch(/Negative days/);
  });

  it("rejects an enum value outside the options", () => {
    expect(reasons(entry("attrition.basis", "weekly", "night-by-night basis"))[0]).toMatch(/not one of: cumulative, night_by_night, other/);
  });

  it("rejects a boolean that is neither true nor false", () => {
    expect(reasons(entry("attrition.audit_rights", "yes", "night-by-night basis"))[0]).toMatch(/Not true or false/);
  });

  it("rejects an impossible date", () => {
    expect(reasons(entry("deal.event_start_date", "2027-02-30", "April 12-16, 2027"))[0]).toMatch(/not a YYYY-MM-DD date/);
  });

  it("rejects a schedule whose band runs backwards", () => {
    const schedule = [{ label: "x", days_prior_min: 90, days_prior_max: 30, pct: 50 }];
    expect(reasons(entry("cancellation.schedule", schedule, "no liability-free window"))[0]).toMatch(/invalid days_prior_max/);
  });
});

describe("verifying each value against the document", () => {
  const verification = (e: unknown) => only(run(e)).verification;

  it("verifies a figure its own quote states", () => {
    expect(verification(entry("cutoff_date.days_prior", 30, "no later than thirty (30) days prior to arrival"))).toBe("verified");
  });

  it("marks a figure its quote contradicts", () => {
    // The failure verification exists for: the model read 90% and wrote 85.
    expect(verification(entry("attrition.threshold", 85, "attrition threshold of ninety percent (90%)"))).toBe("contradicted");
  });

  it("marks a quote that is not in the contract", () => {
    expect(verification(entry("attrition.threshold", 90, "attrition threshold of ninety percent (90%) of the block"))).toBe("unlocated");
  });

  it("locates, without verifying, a boolean and a zero stated in words", () => {
    expect(verification(entry("attrition.high_occupancy_credit", false, "Group shall receive no credit toward its block commitment"))).toBe("located");
    expect(verification(entry("cancellation.liability_free_months", 0, "with no liability-free window"))).toBe("located");
  });

  it("reads room counts from bare digits", () => {
    expect(verification(entry("rebates.comp_room_ratio", 75, "one (1) complimentary room per seventy-five (75) paid room nights"))).toBe("verified");
    expect(verification(entry("rebates.comp_room_ratio", 40, "one (1) complimentary room per seventy-five (75) paid room nights"))).toBe("contradicted");
    expect(verification(entry("deal.peak_night_rooms", 340, "a block of 340 guest rooms on the peak night"))).toBe("verified");
  });

  it("verifies both ends of a date range", () => {
    expect(verification(entry("deal.event_start_date", "2027-04-12", "April 12-16, 2027"))).toBe("verified");
    expect(verification(entry("deal.event_end_date", "2027-04-16", "April 12-16, 2027"))).toBe("verified");
    expect(verification(entry("deal.event_end_date", "2027-04-18", "April 12-16, 2027"))).toBe("located");
  });

  it("accepts a quote that occurs more than once", () => {
    expect(verification(entry("attrition.threshold", 90, "90%"))).toBe("verified");
  });
});

describe("quotes the model cut with an ellipsis", () => {
  const verification = (quote: string, text = TEXT) =>
    validateTerms([entry("attrition.threshold", 90, quote)], HOTEL_TERM_CATALOG, [{ part: "document", text }]).stated[0]
      .verification;

  it("finds every piece in order, and checks the figure", () => {
    expect(verification("Group shall be deemed in attrition...ninety percent (90%) on any night")).toBe("verified");
    expect(verification("Group shall be deemed in attrition … ninety percent (90%) on any night")).toBe("verified");
  });

  it("refuses pieces out of order", () => {
    expect(verification("ninety percent (90%) on any night...Group shall be deemed in attrition")).toBe("unlocated");
  });

  it("refuses a piece too short to prove anything", () => {
    expect(verification("Group...ninety percent (90%) on any night")).toBe("unlocated");
  });

  it("refuses pieces too far apart to be one passage", () => {
    const text = `Group shall be deemed in attrition ${"and so on ".repeat(100)} below ninety percent (90%) on any night.`;
    expect(verification("Group shall be deemed in attrition...ninety percent (90%) on any night", text)).toBe("unlocated");
  });
});

describe("repeats, conflicts and silence", () => {
  it("stores a repeated value once, keeping its best-verified quote", () => {
    const result = run(
      entry("cutoff_date.days_prior", 30, "thirty (30) days prior to arrival, as the footer says"),
      entry("cutoff_date.days_prior", 30, "no later than thirty (30) days prior to arrival")
    );
    expect(only(result).verification).toBe("verified");
    expect(result.conflicts).toEqual([]);
  });

  it("keeps every value of a conflicting key and reports the conflict", () => {
    const result = run(
      entry("cutoff_date.days_prior", 30, "no later than thirty (30) days prior to arrival"),
      entry("cutoff_date.days_prior", 21, "twenty-one (21) days prior to arrival")
    );
    expect(result.stated.map((t) => t.value).sort()).toEqual([21, 30]);
    expect(result.conflicts).toEqual(["cutoff_date.days_prior"]);
  });

  it("records every untouched key as not stated, and a wholly rejected key as neither", () => {
    const result = run(
      entry("attrition.threshold", 90, "ninety percent (90%)"),
      entry("cutoff_date.days_prior", "soon", "thirty (30) days")
    );
    expect(result.not_stated).not.toContain("attrition.threshold");
    expect(result.not_stated).not.toContain("cutoff_date.days_prior");
    expect(result.not_stated).toHaveLength(HOTEL_TERM_CATALOG.terms.length - 2);
  });

  it("treats a missing or invalid confidence as low", () => {
    expect(only(run(entry("attrition.threshold", 90, "ninety percent (90%)", { confidence: "certain" }))).confidence).toBe("low");
  });
});
