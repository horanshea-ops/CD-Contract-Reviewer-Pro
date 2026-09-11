import { readFile } from "node:fs/promises";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { extractDocx } from "@/lib/docx";
import { SPEC_BY_ID } from "@/lib/eval/corpus/specs";
import { scoreTermsRun } from "@/lib/eval/terms/score";
import type { TermsKey, TermsRunRecord, TermsScoreReport } from "@/lib/eval/terms/types";
import { formatUsd } from "@/lib/quantities";
import { HOTEL_TERM_CATALOG, catalogIndex } from "@/lib/terms/catalog";
import type { ScheduleTier, TermValue } from "@/lib/terms/types";
import { validateTerms } from "@/lib/terms/validate";

/**
 * A perfect extraction, scored — free, and against the real corpus.
 *
 * Every keyed value is fed back as a model would return it, quoting the
 * sentence the drafter wrote for it, then validated against the real DOCX text
 * and scored. Anything short of 100% means the key, the verifier or the scorer
 * is wrong, and it is cheaper to find that here than in a paid run.
 */

const CORPUS = path.join("data", "sample-contracts", "eval");
const index = catalogIndex(HOTEL_TERM_CATALOG);

/** Back to the form a model reports: percentages as written, not as fractions. */
function asWritten(key: string, value: TermValue): unknown {
  const def = index.get(key)!;
  const percent = (n: number) => Math.round(n * 100 * 1e6) / 1e6;
  if (def.kind === "number" && def.unit === "pct") return percent(value as number);
  if (def.kind === "schedule") return (value as ScheduleTier[]).map((t) => ({ ...t, pct: percent(t.pct) }));
  return value;
}

let key: TermsKey;
let report: TermsScoreReport;
let run: TermsRunRecord;

beforeAll(async () => {
  key = JSON.parse(await readFile(path.join("data", "eval", "terms-key-v1.json"), "utf8"));
  const documents: TermsRunRecord["documents"] = [];

  for (const entry of key.contracts) {
    const id = entry.contract.replace(/\.docx$/, "");
    const spec = SPEC_BY_ID.get(id)!;
    const drafted: { clause_type: string; anchors: { field: string; sentence: string }[] }[] = JSON.parse(
      await readFile(path.join(CORPUS, `${id}.draft.json`), "utf8")
    );
    const extracted = await extractDocx(new Uint8Array(await readFile(path.join(CORPUS, entry.contract))));

    const quoteFor = (termKey: string, value: TermValue): string => {
      const [group, field] = termKey.split(".");
      if (termKey === "deal.group_rate_usd") return `a group rate of ${formatUsd(spec.adr)} per room`;
      if (termKey === "deal.peak_night_rooms") return `a block of ${spec.room_block} guest rooms on the peak night`;
      if (group === "deal") return `for the event to be held ${spec.dates}`;
      if (termKey === "cancellation.schedule") return (value as ScheduleTier[])[0].label;
      if (termKey === "cancellation.top_tier_pct") return `${Math.round((value as number) * 100)}%`;
      const anchor = drafted.find((c) => c.clause_type === group)?.anchors.find((a) => a.field === field);
      if (!anchor) throw new Error(`${id}: no drafted sentence for ${termKey}`);
      return anchor.sentence;
    };

    const raw = Object.entries(entry.terms)
      .filter(([, v]) => v !== "not_stated")
      .map(([termKey, value]) => ({
        term_key: termKey,
        value: asWritten(termKey, value as TermValue),
        quoted_text: quoteFor(termKey, value as TermValue),
        source_section: null,
        confidence: "high",
      }));

    documents.push({
      contract: entry.contract,
      terms: validateTerms(raw, HOTEL_TERM_CATALOG, extracted.parts),
      error: null,
      tokens: null,
      elapsed_ms: 0,
    });
  }

  run = { run_id: "perfect", created_at: "", model_id: "none", catalog_version: HOTEL_TERM_CATALOG.version, documents };
  report = scoreTermsRun({ key, run, catalog: HOTEL_TERM_CATALOG });
});

describe("a perfect extraction over all seven eval contracts", () => {
  it("scores every value correct and invents nothing", () => {
    expect(report.tally.keyed_values).toBeGreaterThan(400);
    expect(report.tally).toMatchObject({
      correct: report.tally.keyed_values,
      wrong_value: 0,
      conflict: 0,
      missed: 0,
      invented: 0,
      silent_wrong: 0,
      correct_absent: report.tally.keyed_absent,
    });
  });

  it("rejects nothing", () => {
    for (const doc of run.documents) expect(doc.terms!.rejected, doc.contract).toEqual([]);
  });

  it("finds every quote in the real DOCX text, and contradicts none", () => {
    expect(report.verification.unlocated).toBe(0);
    expect(report.verification.contradicted).toBe(0);
  });

  it("verifies every non-zero figure against its own quote", () => {
    // A zero is drafted as meaning ("no liability-free window"), so it has no
    // figure to check and is located instead.
    for (const doc of run.documents) {
      for (const t of doc.terms!.stated) {
        const def = index.get(t.term_key)!;
        if ((def.kind === "number" && t.value !== 0) || def.kind === "date") {
          expect(t.verification, `${doc.contract} ${t.term_key}`).toBe("verified");
        }
      }
    }
  });
});
