import { parseQuantities, phrase } from "../../quantities";
import type { ScheduleTier, TermCatalog, TermDefinition, TermValue } from "../../terms/types";
import { termGroup } from "../../terms/catalog";
import { NOT_STATED, type KeyedValue, type TermsKey, type TermsKeyContract } from "../terms/types";
import { cancellationRows } from "./layout";
import type { EvalContractSpec } from "./spec";

/**
 * The term extraction answer key, derived from the eval specs (§2.0.2).
 *
 * Every value here was fixed before the contract's prose existed, so nobody
 * reads a contract to decide what it says. Clause terms come from the spec;
 * the deal terms and the cancellation schedule come from exactly what the
 * layout printed. A term the corpus cannot vouch for is left unkeyed with its
 * reason, never guessed.
 */

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** "April 12-16, 2027" → ["2027-04-12", "2027-04-16"]. Every spec writes its dates this way. */
export function eventDates(dates: string): [string, string] {
  const m = dates.match(/^([A-Z][a-z]+) (\d{1,2})-(\d{1,2}), (\d{4})$/);
  const month = m ? MONTHS.indexOf(m[1]) + 1 : 0;
  if (!m || month === 0) throw new Error(`Cannot read event dates "${dates}".`);
  const iso = (day: string) => `${m[4]}-${String(month).padStart(2, "0")}-${day.padStart(2, "0")}`;
  return [iso(m[2]), iso(m[3])];
}

/** One printed schedule row → a tier. The labels are the layout's own, so any other wording is a bug here. */
function tierFromRow([label, damages]: string[]): ScheduleTier {
  const pct = damages === "None" ? 0 : Number(damages.replace("%", "")) / 100;
  let band: [number, number | null];
  let m: RegExpMatchArray | null;
  if ((m = label.match(/^(\d+) days or more/))) band = [Number(m[1]), null];
  else if ((m = label.match(/^(\d+) through (\d+) days/))) band = [Number(m[2]), Number(m[1])];
  else if ((m = label.match(/^(\d+) days or fewer/))) band = [0, Number(m[1])];
  else throw new Error(`Unrecognised schedule row "${label}".`);
  return { label, days_prior_min: band[0], days_prior_max: band[1], pct };
}

/**
 * Where a draft does not say what its spec says, found by reading the audit of
 * the first full run (2026-09-11).
 *
 * The drafting gates checked that each dictated figure and meaning reached the
 * prose, but not what role it ended up playing. A few drafts put a figure to a
 * different use, or reworded a meaning until it flipped. The key follows the
 * document, and each entry names the sentence that settles it, so checking one
 * takes a single read.
 */
const CORRECTIONS: Record<string, Record<string, { value: KeyedValue; quote?: string; reason: string }>> = {
  "eval-03-bayfront": {
    "named_storm.cancellation_window_hours": {
      value: 12,
      quote:
        "Group must provide written notice of cancellation to the Hotel's Director of Sales within twelve (12) hours of the National Weather Service's issuance of a hurricane or tropical storm warning for the Portland area.",
      reason: "The spec's 72 hours became the forecast window before the event. The notice window the catalog asks for is 12 hours.",
    },
  },
  "eval-10-crossroads": {
    "fb_minimum.shortfall_rate": {
      value: 1,
      quote: "the Group shall pay to the Hotel the shortfall within thirty (30) days of final invoice",
      reason: "The spec's 80% became the guarantee level, and the Group pays the whole shortfall.",
    },
  },
  "eval-12-granite-bay": {
    "damage_deposit.refund_window_days": {
      value: NOT_STATED,
      reason: "No deposit is required, so there is no refund window. The spec's 30 days became a deadline for an accounting of damage costs.",
    },
  },
  "eval-15-vantage": {
    "fb_minimum.shortfall_rate": {
      value: 1,
      quote:
        "the Group shall be obligated to pay the Hotel a shortfall fee equal to the difference between the Minimum F&B Commitment and the actual charges incurred",
      reason: "The shortfall fee is the whole difference. The spec's 35% became a threshold for renegotiation.",
    },
    "master_account_billing.prepayment_defined": {
      value: false,
      quote:
        "Group shall remit prepayment equal to the percentage of anticipated charges designated by the Hotel prior to the event",
      reason: "The Hotel designates the percentage, so the agreement states none.",
    },
  },
};

/**
 * The figure the contract prints, which is the one extraction should find.
 *
 * The drafter reproduced `phrase(value)` verbatim, and phrase rounds a
 * percentage to one decimal place, so eval-07's 1.25% finance charge reads
 * "1.3%" in the document. Keying the spec's 1.25% would mark a correct reading
 * wrong. Rooms phrase as the integer itself, so need no reading back.
 */
function printed(value: TermValue, def: TermDefinition): TermValue {
  if (def.kind !== "number" || typeof value !== "number" || def.unit === "rooms") return value;
  const quantity = parseQuantities(phrase(value, def.unit!)).find((q) => q.unit === def.unit);
  return quantity ? Number(quantity.value.toFixed(10)) : value;
}

function contractKey(spec: EvalContractSpec, catalog: TermCatalog): TermsKeyContract {
  const terms: Record<string, KeyedValue> = {};
  const unkeyed: Record<string, string> = {};
  const [start, end] = eventDates(spec.dates);

  for (const def of catalog.terms) {
    const { key } = def;
    const group = termGroup(key);
    const field = key.slice(group.length + 1);

    if (group === "deal") {
      if (field === "peak_night_rooms") {
        if (spec.style.tables === "many") {
          unkeyed[key] = "The room-block table prints per-night figures that contradict the prose block (layout.ts).";
        } else {
          terms[key] = spec.room_block;
        }
      } else if (field === "group_rate_usd") terms[key] = spec.adr;
      else if (field === "event_start_date") terms[key] = start;
      else if (field === "event_end_date") terms[key] = end;
      else unkeyed[key] = "The layout never prints it and the drafter was never given it.";
      continue;
    }

    const clause = spec.terms[group];
    if (clause === undefined) {
      unkeyed[key] = `The spec has no "${group}" clause.`;
      continue;
    }
    if (clause === "absent") {
      terms[key] = NOT_STATED;
      continue;
    }

    // The schedule and its top tier exist only in the printed table, which
    // rounds to whole percentages, so both are read from its rows.
    if (group === "cancellation" && (field === "schedule" || field === "top_tier_pct")) {
      const top = typeof clause.top_tier_pct === "number" ? clause.top_tier_pct : 1;
      const free = typeof clause.liability_free_months === "number" ? clause.liability_free_months : 0;
      const tiers = cancellationRows(top, free).map(tierFromRow);
      terms[key] = field === "schedule" ? tiers : tiers[tiers.length - 1].pct;
      continue;
    }

    if (field in clause) terms[key] = printed(clause[field], def);
    else unkeyed[key] = `The spec's "${group}" clause does not set "${field}".`;
  }

  const corrected: NonNullable<TermsKeyContract["corrected"]> = {};
  for (const [key, fix] of Object.entries(CORRECTIONS[spec.id] ?? {})) {
    if (!(key in terms)) throw new Error(`${spec.id}: a correction names "${key}", which the key does not score.`);
    terms[key] = fix.value;
    corrected[key] = fix.quote ? { reason: fix.reason, quote: fix.quote } : { reason: fix.reason };
  }

  return { contract: `${spec.id}.docx`, terms, unkeyed, ...(Object.keys(corrected).length > 0 ? { corrected } : {}) };
}

export function deriveTermsKey(specs: EvalContractSpec[], catalog: TermCatalog): TermsKey {
  return {
    version: "terms-key-v1",
    source: "synthetic",
    catalog_version: catalog.version,
    contracts: specs.map((spec) => contractKey(spec, catalog)),
  };
}
