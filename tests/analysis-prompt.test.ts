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

  describe("quotes and proposals cover whole sentences", () => {
    // A quote that stops mid-sentence under a proposal that ends one leaves the
    // rest of the contract's sentence dangling, and the redline has to skip it.
    it("asks for quotes that start and end where a sentence does", () => {
      expect(prompt()).toContain("each one whole, starting where a sentence starts and ending where it ends");
    });

    it("keeps a quote to the sentences being changed, in one unbroken stretch", () => {
      // Asked only for whole sentences, the model quoted whole clauses. In the
      // combined eval it joined sentences that are apart and ran quotes across
      // paragraphs, and 44 changes could not be marked up.
      const text = prompt();
      expect(text).toContain("Quote only the sentences your proposal changes");
      expect(text).toContain("A quote is one unbroken stretch of a single paragraph");
      expect(text).toContain("Never join sentences that are not next to each other");
      expect(text).toContain("record a separate finding for each place");
    });

    it("forbids shortening a quote with an ellipsis", () => {
      // The Monarch eval's ADA quote skipped its middle with "...", so it
      // matched nothing in the contract and could not be marked up.
      expect(prompt()).toContain('never shorten a quote with "..." or "…"');
    });

    it("says the proposal replaces the whole quote, repeating what stays", () => {
      const text = prompt();
      expect(text).toContain("proposed_language replaces everything in quoted_text and nothing else");
      expect(text).toContain("Repeat word for word any quoted wording that should stay");
    });

    it("says the proposal is contract wording, not an instruction", () => {
      expect(prompt()).toContain("never advice or an instruction to the reviewer");
    });

    // A real contract's review rewrote attrition without quoting it, dropped a
    // refund from force majeure, and replaced a cancellation schedule with a
    // flat fee that cost the group more than the contract did two years out.
    it("asks a rewrite of existing wording to quote it", () => {
      expect(prompt()).toContain("A finding that changes wording already in the contract quotes that wording");
      expect(prompt()).toContain("is_missing_clause is true only when the contract has no wording on the clause at all");
    });

    it("keeps the group's existing protections", () => {
      expect(prompt()).toContain("Keep every protection the quoted wording already gives the group");
    });

    it("keeps a schedule, and changes a table cell by cell", () => {
      const text = prompt();
      expect(text).toContain("Never replace a schedule with one flat figure");
      expect(text).toContain("record a finding for each table cell that changes, quoting that cell");
    });

    it("never lets a proposal cost the group more than the contract", () => {
      expect(prompt()).toContain("It must never cost the group more than the contract does in any case");
    });

    it("asks for the places the contract contradicts itself, only where both sides can be quoted", () => {
      // A real run noted a fee "mismatch" its own detail admitted wasn't one.
      const text = prompt();
      expect(text).toContain("In document_notes, name each place the contract contradicts itself");
      expect(text).toContain("Record one only when you can quote both sides");
      expect(text).toContain("checks table totals and night counts itself");
    });

    it("measures an attrition trigger against the whole block, never past the standard", () => {
      // A real run set the trigger at 70% of a minimum already at 80% of the block.
      const text = prompt();
      expect(text).toContain("An attrition trigger is measured against the whole room block");
      expect(text).toContain("Never propose a threshold that goes further than the standard asks.");
    });

    it("keeps a schedule's wording and its table figures in agreement", () => {
      expect(prompt()).toContain("the wording that introduces a schedule and every figure in it must agree");
    });

    it("asks for terms outside the library, with a quote and no wording", () => {
      const text = prompt();
      expect(text).toContain("Record each in other_findings with its quote");
      expect(text).toContain("Propose no wording for them");
    });

    it("reads the closing boilerplate as closely as the named clauses", () => {
      // The no-finder promise and the logo termination right both sat there, and four runs missed them.
      expect(prompt()).toContain('Read the closing and general paragraphs, such as "Other Provisions" or "Miscellaneous"');
    });

    it("treats a no-finder promise as a threat to the firm's commission", () => {
      const text = prompt();
      expect(text).toContain("used no meeting planner, agent or finder");
      expect(text).toContain("Record it as a commission finding that quotes that sentence");
    });

    it("compares a pickup condition on concessions with the attrition terms", () => {
      const text = prompt();
      expect(text).toContain("depend on the group reaching a pickup level, compare that level with the attrition terms");
      expect(text).toContain("Record it as a rebates finding quoting the condition");
    });

    it("names a termination right over a minor breach as a term outside the library, read to the end", () => {
      const text = prompt();
      expect(text).toContain("a right to end the agreement over a minor or technical breach");
      expect(text).toContain("Read to the end of the contract before deciding what to record");
    });

    it("reads a deadline in days before arrival the right way round", () => {
      // A Rome review called a 14-day cutoff "earlier than CD's 21-day floor" and proposed 21, which is worse for the group.
      expect(prompt()).toContain("14 days before arrival is after 21 days before");
    });

    it("marks a clause type that can't apply to this hotel not_applicable, with no finding", () => {
      const text = prompt();
      expect(text).toContain("A named-storm clause matters only for hotels in hurricane or typhoon regions");
      expect(text).toContain("Give such a clause type the verdict not_applicable, say why in its basis, and record no finding for it");
      expect(text).toContain("Outside the United States, don't ask for ADA compliance by name");
    });

    it("takes figures from the library or the contract, and leaves a blank rather than inventing one", () => {
      // A blank stops the redline, which tells the associate to fill it. An
      // invented figure would reach the property unnoticed.
      const text = prompt();
      expect(text).toContain("Take every figure in it from the standards library or this contract");
      expect(text).toContain("write [X] in its place rather than inventing one");
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

    it("asks for the contract's figures with their quotes, and never a worked-out one", () => {
      // The app works out every exposure itself. A real run's own formulas applied 70% twice.
      const text = prompt();
      expect(text).toContain("Record the contract's figures in deal_figures, each with the words it comes from.");
      expect(text).toContain("never work one out");
      expect(text).not.toContain("exposure_formula");
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

  it("describes quotes as whole sentences, and proposals as replacing all of them", () => {
    const items = properties.findings.items.properties;
    expect(items.quoted_text.description).toContain("One unbroken span copied exactly from a single paragraph");
    expect(items.quoted_text.description).toContain("only the whole sentences being changed");
    expect(items.proposed_language.description).toContain("replaces everything in quoted_text");
    expect(items.proposed_language.description).toContain("never an instruction to the reviewer");
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

  it("limits a verdict to meets, falls_short, missing or not_applicable", () => {
    expect(properties.clause_review.items.properties.verdict.enum).toEqual(["meets", "falls_short", "missing", "not_applicable"]);
  });
});
