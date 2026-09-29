import type { PreviewBlock } from "../docx-preview";
import { renderStructuredPdf } from "../structured-pdf";
import { termByKey, formatTermValue } from "./terms";
import { TIER_LABELS, type ContractRecord } from "./types";

/**
 * A contract's terms laid out as a short PDF, for the Analytics library.
 *
 * It names the hotel and the client but never the associate, so any associate
 * can open any contract's term sheet. The original file, which carries names
 * and signatures, stays behind the review access rule.
 */

const run = (text: string) => ({ text, revision: null, range: null, kind: "text" as const });
const heading = (text: string, level: 1 | 2 = 2): PreviewBlock => ({ kind: "heading", level, runs: [run(text)] });
const para = (text: string): PreviewBlock => ({ kind: "paragraph", runs: [run(text)] });
const cell = (text: string) => ({ blocks: [para(text)] });

function value(record: ContractRecord, key: string): string {
  const term = termByKey(key);
  return term ? formatTermValue(term, record.final[key]) : "—";
}

const article = (word: string) => (/^[aeiou]/i.test(word) ? "an" : "a");

function long(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
}

/** Sections for terms the contract doesn't state are left out, as the contract left them out. */
export async function renderTermSheetPdf(record: ContractRecord): Promise<Uint8Array> {
  const p = record.property;
  const has = (key: string) => record.final[key] !== undefined;
  const yes = (key: string) => record.final[key] === true;
  const location = [p.city, p.state, p.country].filter(Boolean).join(", ");
  let section = 0;
  const numbered = (title: string) => heading(`${++section}. ${title}`);

  const blockRows = [
    ["Peak night rooms", "deal.peak_night_rooms"],
    ["Total room nights", "deal.room_nights"],
    ["Group rate, per room per night", "deal.group_rate_usd"],
    ["Resort fee, per room per night", "mandatory_fees.resort_fee_usd"],
  ].filter(([, key]) => has(key));

  const version = record.status === "signed" ? `signed ${long(record.signedAt!)}` : record.status === "lost" ? "not signed" : "still in negotiation";

  const blocks: PreviewBlock[] = [
    ...(record.source === "test"
      ? [
          heading("TEST DATA: NOT A REAL CONTRACT", 1),
          para("This term sheet was generated from test data for the Analytics tab. Every name and figure in it is invented."),
        ]
      : []),
    heading("Term Sheet", 1),
    para(
      `${record.eventName}, between ${p.name}, ${p.address}, ${location} (${article(TIER_LABELS[p.tier])} ${TIER_LABELS[p.tier].toLowerCase()} property of ${p.brand}, ${p.parentCompany}), ` +
        `and ${record.client.name}, represented by ConferenceDirect. These are the contract's terms, ${version}. Terms the contract doesn't state are left out.`
    ),
    numbered("Dates and Room Block"),
    para(`Arrival ${long(record.eventStart)}, departure ${long(record.eventEnd)}.`),
    { kind: "table", rows: blockRows.map(([label, key]) => ({ cells: [cell(label), cell(value(record, key))] })) },
  ];

  if (has("attrition.threshold")) {
    blocks.push(numbered("Attrition"), para(`Group will pick up at least ${value(record, "attrition.threshold")} of the room block, measured cumulatively.`));
  }
  if (has("cutoff_date.days_prior")) {
    blocks.push(numbered("Cutoff Date"), para(`Rooms not reserved ${value(record, "cutoff_date.days_prior")} before arrival return to the Hotel's inventory.`));
  }
  if (has("cancellation.top_tier_pct") || has("cancellation.resale_credit")) {
    const parts = [];
    if (has("cancellation.top_tier_pct")) {
      parts.push(`Cancellation damages follow a sliding scale, reaching ${value(record, "cancellation.top_tier_pct")} of anticipated room revenue within 30 days of arrival.`);
    }
    if (has("cancellation.resale_credit")) {
      parts.push(yes("cancellation.resale_credit") ? "Revenue from reselling cancelled rooms is credited against damages." : "Revenue from reselling cancelled rooms is not credited.");
    }
    blocks.push(numbered("Cancellation"), para(parts.join(" ")));
  }
  if (has("deal.fb_minimum_usd")) {
    blocks.push(numbered("Food and Beverage"), para(`Group commits to a food and beverage minimum of ${value(record, "deal.fb_minimum_usd")}, before service charge and tax.`));
  }
  if (has("commission.commission_pct")) {
    blocks.push(numbered("Commission"), para(`The Hotel will pay ConferenceDirect ${value(record, "commission.commission_pct")} commission on actualized room revenue.`));
  }
  if (has("rebates.comp_room_ratio")) {
    blocks.push(numbered("Complimentary Rooms"), para(`Group earns one complimentary room night for every ${value(record, "rebates.comp_room_ratio")} paid room nights.`));
  }
  if (has("force_majeure.covers_epidemic")) {
    blocks.push(
      numbered("Force Majeure"),
      para(
        yes("force_majeure.covers_epidemic")
          ? "Either party may cancel without liability for causes beyond its control, including disease, epidemics and government travel advisories."
          : "Either party may cancel without liability for acts of God, war and government action."
      )
    );
  }
  if (yes("rate_parity.guaranteed")) {
    blocks.push(numbered("Rate Parity"), para("The Hotel will not offer a lower rate to the public over the event dates without matching it for the group."));
  }

  const { pdfBytes } = await renderStructuredPdf({ blocks, mode: "clean", ownRevisionIds: new Set() });
  return pdfBytes;
}
