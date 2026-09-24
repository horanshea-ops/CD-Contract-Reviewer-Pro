import { describe, expect, it } from "vitest";
import { wordingProblem } from "@/lib/redline-engine/wording";
import { STANDARDS_LIBRARY } from "@/lib/standards/v1";

/**
 * The model adapts each entry's fallback wording into its proposals. A blank
 * such as "[X]%" left there reaches every proposal for that clause, and the
 * redline then has to leave the change out. Values are filled provisionally
 * until CD confirms them (ROADMAP.md, "Provisional values for CD to confirm").
 */

describe("the standards library's fallback wording", () => {
  it.each(STANDARDS_LIBRARY.map((e) => [e.clause_type, e.fallback_language] as const))(
    "%s has no unfilled blank and reads as contract wording",
    (_, fallback) => {
      expect(wordingProblem(fallback, null)).toBeNull();
    }
  );
});
