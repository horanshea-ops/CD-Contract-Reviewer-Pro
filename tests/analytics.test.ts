import { afterEach, describe, expect, it, vi } from "vitest";
import { extractText, getDocumentProxy } from "unpdf";
import { scopeFor } from "@/lib/analytics/access";
import { applyFilters, filterOptions, parseFilters } from "@/lib/analytics/filters";
import { insights } from "@/lib/analytics/insights";
import { sourceKind } from "@/lib/analytics/source";
import { askOutcome, benchmark, commissionByBrand, median, MIN_SAMPLE, sampled, summarize } from "@/lib/analytics/stats";
import { renderTermSheetPdf } from "@/lib/analytics/term-sheet-pdf";
import { ANALYTICS_TERMS, termByKey } from "@/lib/analytics/terms";
import { generateTestData } from "@/lib/analytics/test-data";
import type { ContractRecord, TermSnapshot } from "@/lib/analytics/types";
import { navLinks } from "@/components/nav-links";

/**
 * The Analytics tab (lib/analytics), on generated test data.
 *
 * The statistics are checked against hand-worked cases. A term a contract
 * doesn't state must stay missing, never become zero. Associates see every
 * contract's terms but only admins see who negotiated it.
 */

const me = { id: "real-1", name: "Test Associate" };
const data = generateTestData({ realAssociates: [me] });
const record = data.contracts[0];

function withTerms(firstDraft: TermSnapshot, requested: TermSnapshot, final: TermSnapshot): ContractRecord {
  return { ...record, firstDraft, requested, final };
}

afterEach(() => vi.unstubAllEnvs());

describe("statistics", () => {
  it("takes medians of odd and even lists", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([])).toBeNull();
  });

  it("withholds a figure below the minimum sample", () => {
    expect(sampled(MIN_SAMPLE - 1, 42).value).toBeNull();
    expect(sampled(MIN_SAMPLE, 42).value).toBe(42);
  });

  it("scores each of CD's asks as given, met partway or refused", () => {
    const attrition = termByKey("attrition.threshold")!;
    const ask = (final: number) => askOutcome(attrition, withTerms({ "attrition.threshold": 85 }, { "attrition.threshold": 70 }, { "attrition.threshold": final }));
    expect(ask(70)).toBe("full");
    expect(ask(75)).toBe("partial");
    expect(ask(85)).toBe("held");
  });

  it("treats a clause CD asked to add as given only when the signed version has it", () => {
    const parity = termByKey("rate_parity.guaranteed")!;
    expect(askOutcome(parity, withTerms({}, { "rate_parity.guaranteed": true }, { "rate_parity.guaranteed": true }))).toBe("full");
    expect(askOutcome(parity, withTerms({}, { "rate_parity.guaranteed": true }, {}))).toBe("held");
  });

  it("scores no ask on a number the draft didn't state", () => {
    const cutoff = termByKey("cutoff_date.days_prior")!;
    expect(askOutcome(cutoff, withTerms({}, {}, {}))).toBeNull();
  });

  it("averages each brand's commission over only the contracts that state one", () => {
    const pct = (brand: string, commission: number | undefined, status: ContractRecord["status"] = "signed"): ContractRecord => ({
      ...record,
      status,
      property: { ...record.property, brand },
      final: commission === undefined ? {} : { "commission.commission_pct": commission },
    });
    const rows = commissionByBrand([
      ...[10, 10, 8, 10, 7].map((v) => pct("A", v)),
      pct("A", undefined),
      pct("A", 1, "negotiating"),
      ...[7, 8].map((v) => pct("B", v)),
    ]);
    expect(rows).toEqual([
      { brand: "A", n: 5, average: 9 },
      { brand: "B", n: 2, average: null },
    ]);
  });

  it("compares nothing for a term the contract doesn't state", () => {
    const pool = data.contracts.filter((c) => c.status === "signed").slice(0, 40);
    const rows = benchmark(withTerms({}, {}, { "deal.group_rate_usd": 200 }), pool);
    const cutoff = rows.find((r) => r.key === "cutoff_date.days_prior")!;
    expect(cutoff.value).toBeUndefined();
    expect(cutoff.shareBetter.value).toBeNull();
    expect(rows.find((r) => r.key === "deal.group_rate_usd")!.shareBetter.value).not.toBeNull();
  });
});

describe("test data", () => {
  it("is the same for the same seed and different for another", () => {
    expect(generateTestData({ realAssociates: [me] })).toEqual(data);
    expect(generateTestData({ seed: 1, realAssociates: [me] }).contracts[0]).not.toEqual(record);
  });

  it("leaves unstated terms out rather than setting them to zero or false", () => {
    const signed = data.contracts.filter((c) => c.status === "signed");
    const stated = (key: string) => signed.filter((c) => c.final[key] !== undefined).length;
    for (const c of data.contracts) {
      for (const snapshot of [c.firstDraft, c.requested, c.final]) {
        for (const value of Object.values(snapshot)) expect(value).not.toBeUndefined();
      }
    }
    // Only resorts and luxury hotels usually state a resort fee, so most contracts leave it out.
    expect(stated("mandatory_fees.resort_fee_usd")).toBeLessThan(signed.length / 2);
    expect(stated("deal.fb_minimum_usd")).toBeLessThan(signed.length);
  });

  it("uses only the terms the tab compares", () => {
    const keys = new Set(ANALYTICS_TERMS.map((t) => t.key));
    for (const c of data.contracts) for (const k of Object.keys(c.final)) expect(keys.has(k)).toBe(true);
  });

  it("carries the patterns it was built with", () => {
    const text = insights(data.contracts).map((i) => i.text).join(" ");
    expect(text).toMatch(/Harborline (Hotels|Grand) refused CD's ask on attrition threshold in 100%/);
    expect(text).toMatch(/Group rates rose fastest at Nashville upper upscale hotels/);
  });

  it("hands some contracts to the real associates", () => {
    expect(data.contracts.some((c) => c.associate.id === me.id)).toBe(true);
    expect(summarize(data.contracts).signed).toBeGreaterThan(0);
  });
});

describe("who sees what", () => {
  const associate = scopeFor({ id: me.id, is_admin: false }, false);
  const admin = scopeFor({ id: "admin-1", is_admin: true }, false);
  const mine = data.contracts.find((c) => c.associate.id === me.id)!;
  const theirs = data.contracts.find((c) => c.associate.id !== me.id)!;

  it("names other associates only to admins", () => {
    expect(associate.showsAssociate(mine)).toBe(true);
    expect(associate.showsAssociate(theirs)).toBe(false);
    expect(admin.showsAssociate(theirs)).toBe(true);
  });

  it("opens another associate's original file only for admins, or when sharing is on", () => {
    expect(associate.canOpenOriginal(mine)).toBe(true);
    expect(associate.canOpenOriginal(theirs)).toBe(false);
    expect(admin.canOpenOriginal(theirs)).toBe(true);
    expect(scopeFor({ id: me.id, is_admin: false }, true).canOpenOriginal(theirs)).toBe(true);
  });

  it("offers the associate filter only to admins", () => {
    const params = { associateId: theirs.associate.id, city: "Nashville" };
    expect(parseFilters(params, associate)).toEqual({ city: "Nashville" });
    expect(parseFilters(params, admin).associateId).toBe(theirs.associate.id);
    expect(filterOptions(data.contracts, associate).associates).toEqual([]);
    expect(filterOptions(data.contracts, admin).associates.length).toBeGreaterThan(1);
  });

  it("filters by place, brand and status", () => {
    const f = parseFilters({ state: "TN", status: "signed", tier: "not-a-tier", from: "bad-date" }, associate);
    expect(f).toEqual({ state: "TN", status: "signed" });
    const rows = applyFilters(data.contracts, f);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.property.state === "TN" && r.status === "signed")).toBe(true);
  });
});

describe("switches", () => {
  it("shows the nav link only while ANALYTICS is on", () => {
    const nav = { name: "A", email: "a@example.com", is_admin: false };
    expect(navLinks(nav).map((l) => l.href)).not.toContain("/analytics");
    expect(navLinks({ ...nav, analytics: true }).map((l) => l.href)).toContain("/analytics");
  });

  it("returns not found for the page and the term sheet while ANALYTICS is off", async () => {
    vi.stubEnv("ANALYTICS", "");
    const { default: Page } = await import("@/app/(app)/analytics/page");
    await expect(Page({ searchParams: Promise.resolve({}) })).rejects.toThrow(/NEXT_HTTP_ERROR_FALLBACK;404/);

    const { GET } = await import("@/app/api/analytics/term-sheets/[id]/route");
    const res = await GET(new Request("http://localhost"), { params: Promise.resolve({ id: record.id }) });
    expect(res.status).toBe(404);
  });

  it("never serves test data in a production build", () => {
    vi.stubEnv("ANALYTICS_SOURCE", "test");
    vi.stubEnv("NODE_ENV", "development");
    expect(sourceKind()).toBe("test");
    vi.stubEnv("NODE_ENV", "production");
    expect(sourceKind()).toBe("database");
  });
});

describe("term sheet", () => {
  async function textOf(c: ContractRecord) {
    const pdf = await getDocumentProxy(await renderTermSheetPdf(c));
    const { text } = await extractText(pdf, { mergePages: true });
    return text as string;
  }

  it("marks test data, leaves out unstated terms and never names the associate", async () => {
    const c = { ...record, final: { ...record.final } };
    delete c.final["deal.fb_minimum_usd"];
    c.final["attrition.threshold"] = 75;
    const text = await textOf(c);
    expect(text).toContain("TEST DATA");
    expect(text).toContain("75%");
    expect(text).not.toContain("Food and Beverage");
    expect(text).not.toContain(c.associate.name);
  });
});
