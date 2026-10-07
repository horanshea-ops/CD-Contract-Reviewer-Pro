import { afterEach, describe, expect, it, vi } from "vitest";
import { exposuresEnabled, withoutArchivedExposure } from "@/lib/exposures/enabled";

/**
 * Exposure math is archived for the beta (docs/archived-features.md). A review
 * run before that still has its figures stored, and they stay hidden until
 * EXPOSURES is switched back on.
 */

const stored = { id: "f1", clause_type: "attrition", exposure_amount: 29800, exposure_basis: "250 room nights at $149", exposure_formula: "(2280 - 2030) * $149 * 0.8" };

afterEach(() => vi.unstubAllEnvs());

describe("the EXPOSURES switch", () => {
  it("is off unless set to on", () => {
    vi.stubEnv("EXPOSURES", "");
    expect(exposuresEnabled()).toBe(false);
    vi.stubEnv("EXPOSURES", "true");
    expect(exposuresEnabled()).toBe(false);
    vi.stubEnv("EXPOSURES", "on");
    expect(exposuresEnabled()).toBe(true);
  });

  it("blanks a stored figure while off, and leaves the rest of the finding alone", () => {
    vi.stubEnv("EXPOSURES", "");
    expect(withoutArchivedExposure(stored)).toEqual({
      id: "f1",
      clause_type: "attrition",
      exposure_amount: null,
      exposure_basis: null,
      exposure_formula: null,
    });
    // The stored row itself is untouched.
    expect(stored.exposure_amount).toBe(29800);
  });

  it("gives the stored figure back while on", () => {
    vi.stubEnv("EXPOSURES", "on");
    expect(withoutArchivedExposure(stored)).toBe(stored);
  });
});
