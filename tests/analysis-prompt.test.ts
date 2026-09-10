import { describe, it, expect } from "vitest";
import { buildSystemPrompt, FINDINGS_TOOL_SCHEMA } from "@/lib/anthropic";
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

    it("names clauses_checked as where coverage is recorded instead", () => {
      const text = prompt();
      expect(text).toContain("clauses_checked is what shows that");
      expect(text).toContain("List every clause type you checked in clauses_checked");
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
  const properties = FINDINGS_TOOL_SCHEMA.input_schema.properties;

  it("tells the model what belongs in findings", () => {
    expect(properties.findings.description).toContain("Deviations only");
    expect(properties.findings.description).toContain("belongs in clauses_checked");
  });

  it("says proposed_language is always an actual change", () => {
    const described = properties.findings.items.properties.proposed_language;
    expect(described.description).toContain("never a note that no change is needed");
  });

  it("describes the tool as deviations plus coverage, not as everything found", () => {
    expect(FINDINGS_TOOL_SCHEMA.description).toContain("deviations found");
    expect(FINDINGS_TOOL_SCHEMA.description).toContain("clause types examined");
  });

  it("still requires the fields the pipeline depends on", () => {
    expect(properties.findings.items.required).toEqual(
      expect.arrayContaining(["clause_type", "is_missing_clause", "severity", "proposed_language"])
    );
    expect(FINDINGS_TOOL_SCHEMA.input_schema.required).toEqual(
      expect.arrayContaining(["findings", "clauses_checked"])
    );
  });
});
