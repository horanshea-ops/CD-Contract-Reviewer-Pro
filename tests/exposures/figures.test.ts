import { describe, expect, it, vi } from "vitest";
import { attritionExposure, cancellationExposure, fbMinimumExposure } from "@/lib/exposures/compute";
import { EXPOSURE_TERM_KEYS, figuresFromTerms, readFigures } from "@/lib/exposures/figures";
import { HOTEL_TERM_CATALOG } from "@/lib/terms/catalog";
import { validateTerms } from "@/lib/terms/validate";

/**
 * The contract's figures, as the term pass reads them. Each case goes from the
 * model's raw entries through the term checks, since that is the only path a
 * figure takes. The wording is invented.
 */
describe("figuresFromTerms", () => {
  const FLORIDA = [
    "Total Room Nights: 2,900",
    "Run of House: $149.00 per night.",
    "You agree that you will use at least 2,280 room nights.",
    "The attrition fee is the shortfall times the rate times eighty percent (80%).",
    "90 Days or Less: $305,748.00 [the Minimum Number of Room Nights, times the Group Room Rate, times 90%]",
    "You agree to spend at least $100,000.00 on food and beverage.",
  ].join("\n");
  const floridaParts = [{ part: "document", text: FLORIDA }];

  const TIER_QUOTE = "the Minimum Number of Room Nights, times the Group Room Rate, times 90%";
  const entry = (term_key: string, value: unknown, quoted_text: string) => ({ term_key, value, quoted_text, confidence: "high" });

  const FLORIDA_ENTRIES = [
    entry("deal.room_block_room_nights", 2900, "Total Room Nights: 2,900"),
    entry("deal.group_rate_usd", 149, "Run of House: $149.00 per night."),
    entry("deal.fb_minimum_usd", 100000, "at least $100,000.00 on food and beverage"),
    entry("attrition.minimum_room_nights", 2280, "at least 2,280 room nights"),
    entry("attrition.liability_rate", 80, "times eighty percent (80%)"),
    entry("cancellation.top_tier_pct", 90, TIER_QUOTE),
    entry("cancellation.damages_basis", "gross_revenue", TIER_QUOTE),
    entry("cancellation.damages_room_nights", "minimum_commitment", TIER_QUOTE),
    entry(
      "cancellation.schedule",
      [
        { label: "91 - 180 Days", days_prior_min: 91, days_prior_max: 180, pct: 75 },
        { label: "90 Days or Less", days_prior_min: 0, days_prior_max: 90, pct: 90 },
      ],
      "90 Days or Less: $305,748.00"
    ),
  ];

  const read = (entries: unknown[], parts = floridaParts) => figuresFromTerms(validateTerms(entries, HOTEL_TERM_CATALOG, parts));
  const without = (key: string) => FLORIDA_ENTRIES.filter((e) => e.term_key !== key);

  it("asks the reading pass for terms the catalog has", () => {
    const keys = new Set(HOTEL_TERM_CATALOG.terms.map((t) => t.key));
    expect(EXPOSURE_TERM_KEYS.filter((key) => !keys.has(key))).toEqual([]);
  });

  it("gives the Florida review's figures, and its $121,524.40", () => {
    const figures = read(FLORIDA_ENTRIES);
    expect(figures).toEqual({
      room_block_room_nights: 2900,
      group_rate: 149,
      minimum_room_nights: 2280,
      attrition_threshold_pct: null,
      attrition_damages_pct: 0.8,
      cancellation_tiers: [{ label: "90 Days or Less", room_pct: 0.9, base: "minimum_room_nights", charges: "rate" }],
      fb_minimum: 100000,
      fb_shortfall_pct: null,
      currency: "$",
    });
    expect(attritionExposure(figures)?.amount).toBe(29800);
    expect(cancellationExposure(figures)?.amount).toBe(91724.4);
    expect(fbMinimumExposure(figures)).toBeNull();
  });

  it("drops a number its quote contradicts, or whose quote isn't in the contract", () => {
    const figures = read([
      entry("attrition.minimum_room_nights", 2900, "at least 2,280 room nights"),
      entry("deal.group_rate_usd", 149, "Run of House: $149.00 per room"),
    ]);
    expect(figures).toMatchObject({ minimum_room_nights: null, group_rate: null, currency: null });
  });

  it("gives no figure for a term the contract states with two values", () => {
    const figures = read([...FLORIDA_ENTRIES, entry("attrition.minimum_room_nights", 2900, "Total Room Nights: 2,900")]);
    expect(figures.minimum_room_nights).toBeNull();
    expect(figures.room_block_room_nights).toBe(2900);
  });

  it("says why each figure is missing, and says nothing when none is", () => {
    const notes = (entries: unknown[]) => readFigures(validateTerms(entries, HOTEL_TERM_CATALOG, floridaParts)).notes;
    vi.spyOn(console, "warn").mockImplementation(() => {});

    expect(notes(FLORIDA_ENTRIES)).toEqual([]);
    expect(notes([...FLORIDA_ENTRIES, entry("attrition.minimum_room_nights", 2900, "Total Room Nights: 2,900")])).toEqual([
      { term_key: "attrition.minimum_room_nights", reason: "The reading gave more than one value for it, so none is used." },
    ]);
    expect(notes(without("cancellation.damages_basis")).map((n) => n.term_key)).toEqual(["cancellation.damages_basis"]);
    expect(notes(without("cancellation.damages_room_nights")).map((n) => n.term_key)).toEqual(["cancellation.damages_room_nights"]);
    expect(notes([entry("attrition.minimum_room_nights", 2900, "at least 2,280 room nights")])[0]).toEqual({
      term_key: "attrition.minimum_room_nights",
      reason: "Its quote does not single out the value (contradicted).",
    });
  });

  it("takes a quoted row's total as the block, and builds nothing on any other number in the row", () => {
    const row = "Total Room Block | 70 | 100 | 360 | 530";
    const parts = [{ part: "document", text: `| ${row} |` }];
    const reading = (value: number) => readFigures(validateTerms([entry("deal.room_block_room_nights", value, row)], HOTEL_TERM_CATALOG, parts));
    vi.spyOn(console, "warn").mockImplementation(() => {});

    expect(reading(530).figures.room_block_room_nights).toBe(530);
    expect(reading(360).figures.room_block_room_nights).toBeNull();
    expect(reading(360).notes).toContainEqual({
      term_key: "deal.room_block_room_nights",
      reason: "Its quote does not single out the value (located).",
    });
  });

  it("gives no cancellation exposure unless the reader says what the percentage is charged on", () => {
    expect(read(without("cancellation.damages_basis")).cancellation_tiers).toEqual([]);

    const noBase = read(without("cancellation.damages_room_nights"));
    expect(noBase.cancellation_tiers).toEqual([{ label: "90 Days or Less", room_pct: 0.9, base: "other", charges: "rate" }]);
    expect(cancellationExposure(noBase)).toBeNull();
  });

  it("reads a room-profit schedule as one, and names the tier when no schedule was read", () => {
    const figures = read([
      ...without("cancellation.damages_basis").filter((e) => e.term_key !== "cancellation.schedule"),
      entry("cancellation.damages_basis", "room_profit", TIER_QUOTE),
    ]);
    expect(figures.cancellation_tiers).toEqual([
      { label: "closest to arrival", room_pct: 0.9, base: "minimum_room_nights", charges: "room_profit" },
    ]);
  });

  it("keeps a euro amount from its quote, and works the F&B gap out in euros", () => {
    const EURO = [
      "Client agrees to provide a minimum of € 20,000.00 + Vat 10% for food and beverage.",
      "Deluxe room: 469,00 EUR per night.",
      "Any shortfall is charged in full, at one hundred percent (100%).",
    ].join("\n");
    const figures = read(
      [
        entry("deal.fb_minimum_usd", 20000, "a minimum of € 20,000.00 + Vat 10%"),
        entry("deal.group_rate_usd", 469, "Deluxe room: 469,00 EUR per night."),
        entry("fb_minimum.shortfall_rate", 100, "one hundred percent (100%)"),
      ],
      [{ part: "document", text: EURO }]
    );
    expect(figures).toMatchObject({ fb_minimum: 20000, group_rate: 469, fb_shortfall_pct: 1, currency: "€" });
    expect(fbMinimumExposure(figures)).toMatchObject({ amount: 13000, formula: "€20000 * (1 - 0.35)" });
  });

  it("drops a euro amount its quote doesn't carry", () => {
    const parts = [{ part: "document", text: "Client agrees to provide a minimum of € 20,000.00 + Vat 10%." }];
    expect(read([entry("deal.fb_minimum_usd", 25000, "a minimum of € 20,000.00 + Vat 10%")], parts)).toMatchObject({
      fb_minimum: null,
      currency: null,
    });
  });
});
