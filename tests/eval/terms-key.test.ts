import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { deriveTermsKey, eventDates } from "@/lib/eval/corpus/derive-terms-key";
import { EVAL_SPECS } from "@/lib/eval/corpus/specs";
import { HOTEL_TERM_CATALOG } from "@/lib/terms/catalog";
import type { TermsKey } from "@/lib/eval/terms/types";

const derived = deriveTermsKey(EVAL_SPECS, HOTEL_TERM_CATALOG);
const contract = (id: string) => derived.contracts.find((c) => c.contract === `${id}.docx`)!;

describe("the term extraction key", () => {
  it("matches the committed file", async () => {
    // Regenerate with `npm run eval:terms:key` after changing a spec, the
    // layout or the catalog. A stale key scores the model against values the
    // contracts no longer carry.
    const committed: TermsKey = JSON.parse(await readFile(path.join("data", "eval", "terms-key-v1.json"), "utf8"));
    expect(committed).toEqual(derived);
  });

  it("keys every catalog term or says why not", () => {
    for (const c of derived.contracts) {
      const covered = new Set([...Object.keys(c.terms), ...Object.keys(c.unkeyed ?? {})]);
      expect(covered.size, c.contract).toBe(HOTEL_TERM_CATALOG.terms.length);
    }
  });

  it("reads clause terms from the spec and deal terms from what the layout printed", () => {
    const e01 = contract("eval-01-harborview").terms;
    expect(e01["attrition.threshold"]).toBe(0.9);
    expect(e01["attrition.basis"]).toBe("night_by_night");
    expect(e01["named_storm.cancellation_window_hours"]).toBe(24);
    expect(e01["deal.group_rate_usd"]).toBe(289);
    expect(e01["deal.event_start_date"]).toBe("2027-04-12");
    expect(e01["deal.event_end_date"]).toBe("2027-04-16");
  });

  it("keys the figure the contract prints, not the spec's unrounded one", () => {
    // eval-07's spec says 1.25%; phrase() rounds it and the contract reads 1.3%.
    const spec = EVAL_SPECS.find((s) => s.id === "eval-07-monarch")!;
    const billing = spec.terms.master_account_billing;
    expect(billing !== "absent" && billing.finance_charge_monthly_pct).toBe(0.0125);
    expect(contract("eval-07-monarch").terms["master_account_billing.finance_charge_monthly_pct"]).toBe(0.013);
  });

  it("follows the document where a draft does not say what its spec says", () => {
    const e10 = contract("eval-10-crossroads");
    expect(e10.terms["fb_minimum.shortfall_rate"]).toBe(1);
    expect(e10.corrected?.["fb_minimum.shortfall_rate"]?.reason).toMatch(/guarantee level/);

    expect(contract("eval-12-granite-bay").terms["damage_deposit.refund_window_days"]).toBe("not_stated");

    const all = derived.contracts.flatMap((c) => Object.keys(c.corrected ?? {}));
    expect(all).toHaveLength(5);
  });

  it("reads the cancellation schedule from the printed rows", () => {
    expect(contract("eval-01-harborview").terms["cancellation.schedule"]).toEqual([
      { label: "365 days or more prior to arrival", days_prior_min: 365, days_prior_max: null, pct: 0.25 },
      { label: "364 through 181 days prior to arrival", days_prior_min: 181, days_prior_max: 364, pct: 0.5 },
      { label: "180 through 91 days prior to arrival", days_prior_min: 91, days_prior_max: 180, pct: 0.75 },
      { label: "90 through 31 days prior to arrival", days_prior_min: 31, days_prior_max: 90, pct: 0.9 },
      { label: "30 days or fewer prior to arrival", days_prior_min: 0, days_prior_max: 30, pct: 1 },
    ]);
  });

  it("keys every term of an absent clause as not stated", () => {
    const spec = EVAL_SPECS.find((s) => s.id === "eval-05-riverwalk")!;
    const absent = Object.entries(spec.terms).filter(([, v]) => v === "absent").map(([k]) => k);
    expect(absent.length).toBeGreaterThan(0);

    const terms = contract("eval-05-riverwalk").terms;
    for (const group of absent) {
      const keys = HOTEL_TERM_CATALOG.terms.filter((t) => t.key.startsWith(`${group}.`)).map((t) => t.key);
      for (const key of keys) expect(terms[key], key).toBe("not_stated");
    }
  });

  it("leaves unkeyed what the corpus cannot vouch for", () => {
    for (const c of derived.contracts) expect(c.unkeyed?.["deal.fb_minimum_usd"]).toMatch(/never prints it/);

    const tableHeavy = EVAL_SPECS.filter((s) => s.style.tables === "many").map((s) => `${s.id}.docx`);
    for (const c of derived.contracts) {
      if (tableHeavy.includes(c.contract)) expect(c.unkeyed?.["deal.peak_night_rooms"]).toMatch(/contradict/);
      else expect(typeof c.terms["deal.peak_night_rooms"]).toBe("number");
    }
  });

  it("reads every spec's dates", () => {
    expect(eventDates("December 1-3, 2027")).toEqual(["2027-12-01", "2027-12-03"]);
    expect(() => eventDates("Dec 1 to 3")).toThrow(/Cannot read event dates/);
  });
});
