import { describe, it, expect } from "vitest";
import { buildSystemPrompt, findingsToolSchema } from "@/lib/anthropic";
import { STANDARDS_LIBRARY, STANDARDS_LIBRARY_VERSION } from "@/lib/standards/v1";

/**
 * The analysis prompt, asserted rule by rule.
 *
 * Several of these rules exist because a measured run showed what happens
 * without them (docs/eval-baseline-2026-09-10.txt). A rule added after a
 * failure is the kind most easily lost in a later edit, and losing one costs
 * half the output's usefulness without breaking anything visible.
 */

const prompt = () => buildSystemPrompt(STANDARDS_LIBRARY, STANDARDS_LIBRARY_VERSION)
  .map((block) => block.text)
  .join("\n");

describe("the analysis system prompt", () => {
  it("carries the standards library and its version", () => {
    const text = prompt();
    expect(text).toContain(STANDARDS_LIBRARY_VERSION);
    expect(text).toContain("attrition");
    expect(text).toContain("walk_relocation");
  });

  it("caches the library block and not the instructions", () => {
    // The instructions change with the code; the library changes with the
    // admin screen. Caching the pair together would invalidate on either.
    const blocks = buildSystemPrompt(STANDARDS_LIBRARY, STANDARDS_LIBRARY_VERSION);
    expect(blocks).toHaveLength(2);
    expect(blocks[0].cache_control).toBeUndefined();
    expect(blocks[1].cache_control).toEqual({ type: "ephemeral" });
  });

  it("still refuses to present itself as legal advice", () => {
    const text = prompt();
    expect(text).toContain("not legal advice");
    expect(text).toContain('is "safe" or "cleared."');
  });

  describe("a finding means a deviation", () => {
    // The first measured run filed 88 findings against 90 real problems,
    // because a compliant clause was recorded to show it had been examined.
    it("says a compliant clause is not a finding", () => {
      expect(prompt()).toContain("A clause that already matches CD's position is NOT a finding");
    });

    it("names clause_review as where coverage is recorded instead", () => {
      const text = prompt();
      expect(text).toContain("clause_review is what shows that");
      expect(text).toContain("Review every clause type in the standards library before recording any findings");
    });

    it("says what a spurious finding costs downstream", () => {
      // The reason matters more than the rule: a finding is marked up, put in
      // the client memo, and named to the property.
      expect(prompt()).toMatch(/marked up in the contract[\s\S]*memo to the client[\s\S]*email to the property/);
    });

    it("bans the wording the model actually used", () => {
      const text = prompt();
      for (const banned of ["compliant", "no change recommended", "matches CD's standard"]) {
        expect(text).toContain(`"${banned}"`);
      }
    });
  });

  describe("a narrow deviation is still a deviation", () => {
    // The first pass at the findings-shape rules cost a real finding: a 35-day
    // cutoff against CD's 30 went unreported, having been checked. Telling the
    // model not to file compliant clauses reads, without this, as "when in
    // doubt, stay quiet".
    it("says the margin does not matter", () => {
      expect(prompt()).toContain("A deviation is a finding however narrow the margin");
    });

    it("takes materiality out of the model's hands", () => {
      // Measured: it checked a 45-room comp ratio against CD's 40 and a 60-hour
      // storm window against CD's 72, and reported neither. Deciding a gap is
      // too small to raise is triage, and triage belongs to the associate.
      const text = prompt();
      expect(text).toContain("Do not weigh whether a gap is wide enough to be worth raising");
      expect(text).toContain("belongs to the associate reading your output");
    });

    it("frames silence about a clause as a positive claim that it complies", () => {
      expect(prompt()).toContain("Leaving a clause out of findings is a statement that it MEETS CD's position");
    });

    it("says a narrow margin lowers nothing and excuses nothing", () => {
      expect(prompt()).toContain("A narrow margin is not a reason to lower the severity");
    });
  });

  describe("every clause gets a verdict", () => {
    // The Sept 22 run listed all 34 clause types as checked on every contract
    // and still missed 19 items. Nine were clauses silent on a required term,
    // and five were clauses the contract left out entirely.
    it("asks for one clause_review entry per clause type", () => {
      expect(prompt()).toContain("Give each one entry in clause_review");
    });

    it("says silence on a required term falls short", () => {
      expect(prompt()).toContain("A clause that says nothing about a term CD's position requires falls short of it");
    });

    it("says an absent clause is missing and gets a missing-clause finding", () => {
      expect(prompt()).toContain("is missing, and its finding sets is_missing_clause to true");
    });

    it("ties findings to verdicts", () => {
      expect(prompt()).toContain("Record a finding for every clause whose verdict is falls_short or missing, and for no other");
    });
  });

  describe("headline", () => {
    // The review card leads with it, so it has to stand alone in one line.
    it("asks for one short, plain line that doesn't repeat the clause name", () => {
      const text = prompt();
      expect(text).toContain("headline is the one line a reviewer reads first");
      expect(text).toContain("Don't repeat the clause name");
    });

    it("forbids a figure the finding doesn't state", () => {
      expect(prompt()).toContain("don't use a figure the finding doesn't state");
    });
  });

  describe("severity", () => {
    it("anchors severity to the library rather than leaving it free", () => {
      expect(prompt()).toContain("severity comes from that clause's severity_default");
    });

    it("requires a reason for departing from it", () => {
      const text = prompt();
      expect(text).toContain("say why in finding_text");
      expect(text).toContain("Calling everything high is the same as calling nothing high");
    });
  });

  describe("quoting and exposure, unchanged by the findings-shape work", () => {
    it("requires quoted_text verbatim and warns off the layout markers", () => {
      const text = prompt();
      expect(text).toContain("copied verbatim from the contract");
      expect(text).toContain("layout markers are ours");
    });

    it("forbids inventing an exposure figure", () => {
      expect(prompt()).toContain("Never estimate or invent a figure");
    });
  });
});

describe("the findings tool schema", () => {
  const schema = findingsToolSchema();
  const properties = schema.input_schema.properties;

  it("tells the model what belongs in findings", () => {
    expect(properties.findings.description).toContain("Deviations only");
    expect(properties.findings.description).toContain("meets verdict in clause_review");
  });

  it("says proposed_language is always an actual change", () => {
    const described = properties.findings.items.properties.proposed_language;
    expect(described.description).toContain("never a note that no change is needed");
  });

  it("describes the tool as deviations plus coverage, not as everything found", () => {
    expect(schema.description).toContain("deviations found");
    expect(schema.description).toContain("verdict on every clause type examined");
  });

  it("still requires the fields the pipeline depends on", () => {
    expect(properties.findings.items.required).toEqual(
      expect.arrayContaining(["clause_type", "is_missing_clause", "severity", "headline", "proposed_language"])
    );
    expect(schema.input_schema.required).toEqual(
      expect.arrayContaining(["clause_review", "findings"])
    );
  });

  it("puts clause_review before findings, so the model writes verdicts first", () => {
    const order = Object.keys(properties);
    expect(order.indexOf("clause_review")).toBeLessThan(order.indexOf("findings"));
  });

  it("limits a verdict to meets, falls_short or missing", () => {
    expect(properties.clause_review.items.properties.verdict.enum).toEqual(["meets", "falls_short", "missing"]);
  });
});
