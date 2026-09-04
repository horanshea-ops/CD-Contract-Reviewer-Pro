import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { writeFile } from "fs/promises";
import path from "path";

/**
 * Builds a short, entirely fictional hotel contract PDF with a handful of
 * deliberately unfavorable clauses baked in, so the pipeline can be tested
 * end to end without needing any real CD contract. Not a real property, not
 * real numbers — purely a fixture for §10.1's synthetic answer key.
 */

const SECTIONS: { heading: string; body: string }[] = [
  {
    heading: "§1. Room Block",
    body: "The Hotel will hold a block of 200 guest rooms per night for the Group for the nights of June 1-4, 2027, at a rate of $259.00 per room, per night, single/double occupancy.",
  },
  {
    heading: "§2. Attrition",
    body: "Group agrees to utilize at least ninety-five percent (95%) of the room block on a night-by-night basis. Should actual pickup on any individual night fall below this amount, Group shall pay liquidated damages equal to the full room rate, including estimated taxes and fees, for each unoccupied room below the 95% threshold on that night, regardless of whether other nights in the block were oversold.",
  },
  {
    heading: "§3. Cancellation",
    body: "In the event Group cancels this Agreement for any reason more than twelve (12) months prior to arrival, Group shall pay the Hotel liquidated damages equal to seventy-five percent (75%) of total anticipated Group revenue, including estimated room revenue, food and beverage revenue, and ancillary revenue, as calculated by the Hotel.",
  },
  {
    heading: "§4. Food & Beverage Minimum",
    body: "Group agrees to a food and beverage minimum of $45,000, exclusive of service charge, gratuity, and applicable taxes, for the duration of the event. Any shortfall between actual F&B revenue and this minimum will be billed to Group's master account as a flat fee.",
  },
  {
    heading: "§5. Cutoff Date",
    body: "The cutoff date for the room block is forty-five (45) days prior to the Group's arrival date. Reservations received after the cutoff date will be accepted at the Hotel's then-prevailing rack rate, subject to availability.",
  },
  {
    heading: "§6. Force Majeure",
    body: "Neither party shall be liable for failure to perform this Agreement where such failure is caused by fire, flood, earthquake, or other act of God that physically renders the Hotel's premises unusable for the event.",
  },
  {
    heading: "§7. Mandatory Fees",
    body: "In addition to the room rate, Group and its attendees will be responsible for a hotel amenity fee, currently $25.00 per room per night, which may be adjusted by the Hotel from time to time upon notice.",
  },
  {
    heading: "§8. Master Account",
    body: "All charges to the Group master account are due in full within fifteen (15) days of the Group's departure date. A late payment fee of 2% per month will apply to any unpaid balance.",
  },
];

async function main() {
  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  let page = pdfDoc.addPage([612, 792]); // US letter
  const margin = 56;
  const maxWidth = 612 - margin * 2;
  let y = 792 - margin;

  function wrapText(text: string, fontToUse: typeof font, size: number): string[] {
    const words = text.split(" ");
    const lines: string[] = [];
    let current = "";
    for (const word of words) {
      const trial = current ? `${current} ${word}` : word;
      if (fontToUse.widthOfTextAtSize(trial, size) > maxWidth) {
        if (current) lines.push(current);
        current = word;
      } else {
        current = trial;
      }
    }
    if (current) lines.push(current);
    return lines;
  }

  function ensureSpace(lines: number, lineHeight: number) {
    if (y - lines * lineHeight < margin) {
      page = pdfDoc.addPage([612, 792]);
      y = 792 - margin;
    }
  }

  const title = "GROUP HOTEL AGREEMENT (SAMPLE — SYNTHETIC TEST DOCUMENT)";
  const titleLines = wrapText(title, boldFont, 14);
  ensureSpace(titleLines.length, 18);
  for (const line of titleLines) {
    page.drawText(line, { x: margin, y, size: 14, font: boldFont, color: rgb(0, 0, 0) });
    y -= 18;
  }
  y -= 10;

  const intro =
    "This Agreement is entered into between Fictional Riverside Hotel & Conference Center (\"Hotel\") and Sample Client Group (\"Group\"), arranged by ConferenceDirect, for the event described below. This is a fabricated document created solely to test an internal contract-review tool and does not describe any real property, client, or transaction.";
  const introLines = wrapText(intro, font, 10);
  ensureSpace(introLines.length, 13);
  for (const line of introLines) {
    page.drawText(line, { x: margin, y, size: 10, font, color: rgb(0.3, 0.3, 0.3) });
    y -= 13;
  }
  y -= 14;

  for (const section of SECTIONS) {
    const headingLines = wrapText(section.heading, boldFont, 11);
    ensureSpace(headingLines.length + 1, 15);
    for (const line of headingLines) {
      page.drawText(line, { x: margin, y, size: 11, font: boldFont, color: rgb(0, 0, 0) });
      y -= 15;
    }

    const bodyLines = wrapText(section.body, font, 10);
    ensureSpace(bodyLines.length, 14);
    for (const line of bodyLines) {
      page.drawText(line, { x: margin, y, size: 10, font, color: rgb(0, 0, 0) });
      y -= 14;
    }
    y -= 12;
  }

  const bytes = await pdfDoc.save();
  const outPath = path.join(process.cwd(), "data", "sample-contracts", "synthetic-sample-1.pdf");
  await writeFile(outPath, bytes);
  console.log(`Wrote ${outPath} (${bytes.length} bytes)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
