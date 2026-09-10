import JSZip from "jszip";

/**
 * OOXML assembly for the eval corpus (MASTER_PLAN.md §2.0.1).
 *
 * Hand-written XML rather than a library, for the same reason
 * scripts/generate-docx-fixtures.ts is: a document produced by the tool under
 * test cannot show that tool handles documents it did not write.
 *
 * Separate from that script rather than shared with it. §1.4.8 asserts the
 * §1.11 fixtures byte-for-byte, so refactoring their generator to serve this
 * one risks a fixture change for a reason unrelated to fixtures. These
 * contracts need page breaks, exhibits and signature blocks that those
 * fixtures do not, and the duplication is cheaper than the coupling.
 *
 * Section numbers are literal text in the heading ("3. Attrition") rather than
 * numbering.xml. lib/redline-engine/locate.ts reads both the extractor's "#"
 * heading marker and a leading clause number, so literal numbering gives
 * section disambiguation without a numbering part to keep consistent.
 */

export type Block =
  | { kind: "heading"; level: 1 | 2; text: string }
  | { kind: "para"; text: string }
  | { kind: "table"; header: string[]; rows: string[][] }
  | { kind: "pageBreak" };

export interface ContractDocument {
  title: string;
  blocks: Block[];
  /** Running header text. Hotels routinely put binding terms here. */
  header?: string;
  footer?: string;
}

const W_NS =
  'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
  'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';

const BASE_CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>`;

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
  <w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:pPr><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:sz w:val="30"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:pPr><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:b/><w:sz w:val="24"/></w:rPr></w:style>
</w:styles>`;

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function run(text: string, rPr = ""): string {
  return `<w:r>${rPr}<w:t xml:space="preserve">${esc(text)}</w:t></w:r>`;
}

function para(inner: string, pPr = ""): string {
  return `<w:p>${pPr}${inner}</w:p>`;
}

function heading(text: string, level: 1 | 2): string {
  return para(run(text), `<w:pPr><w:pStyle w:val="Heading${level}"/></w:pPr>`);
}

function table(header: string[], rows: string[][]): string {
  const columns = header.length;
  const grid = `<w:tblGrid>${Array.from({ length: columns }, () => `<w:gridCol w:w="${Math.floor(9360 / columns)}"/>`).join("")}</w:tblGrid>`;

  const cell = (text: string, bold: boolean) =>
    `<w:tc><w:tcPr><w:tcW w:w="${Math.floor(9360 / columns)}" w:type="dxa"/></w:tcPr>${para(
      run(text, bold ? "<w:rPr><w:b/></w:rPr>" : "")
    )}</w:tc>`;

  const body = [header.map((h) => cell(h, true)), ...rows.map((r) => r.map((c) => cell(c, false)))]
    .map((cells) => `<w:tr>${cells.join("")}</w:tr>`)
    .join("");

  return (
    `<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/><w:tblBorders>` +
    `<w:top w:val="single" w:sz="4"/><w:left w:val="single" w:sz="4"/><w:bottom w:val="single" w:sz="4"/>` +
    `<w:right w:val="single" w:sz="4"/><w:insideH w:val="single" w:sz="4"/><w:insideV w:val="single" w:sz="4"/>` +
    `</w:tblBorders></w:tblPr>${grid}${body}</w:tbl>`
  );
}

function renderBlock(block: Block): string {
  switch (block.kind) {
    case "heading":
      return heading(block.text, block.level);
    case "para":
      return para(run(block.text));
    case "table":
      // A bare table can leave the following paragraph merged into it in some
      // readers, so every table is followed by an empty paragraph.
      return table(block.header, block.rows) + para("");
    case "pageBreak":
      return para(`<w:r><w:br w:type="page"/></w:r>`);
  }
}

// Fixed so regenerating the corpus produces byte-identical files. Per-entry,
// not a generateAsync option — the same trap scripts/generate-docx-fixtures.ts
// documents, where a mis-placed date silently stamps each entry with build time.
const FIXED_DATE = new Date("2026-01-01T00:00:00Z");

export async function buildContractDocx(doc: ContractDocument): Promise<Uint8Array> {
  const body = doc.blocks.map(renderBlock).join("");

  const hasHeader = Boolean(doc.header);
  const hasFooter = Boolean(doc.footer);

  const overrides = [
    hasHeader
      ? `\n  <Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>`
      : "",
    hasFooter
      ? `\n  <Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>`
      : "",
  ].join("");

  const rels = [
    `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>`,
    hasHeader
      ? `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/>`
      : "",
    hasFooter
      ? `<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/>`
      : "",
  ].filter(Boolean);

  const sectPrExtra =
    (hasHeader ? `<w:headerReference w:type="default" r:id="rId2"/>` : "") +
    (hasFooter ? `<w:footerReference w:type="default" r:id="rId3"/>` : "");

  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document ${W_NS}><w:body>${body}<w:sectPr>${sectPrExtra}<w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body></w:document>`;

  const zip = new JSZip();
  // createFolders:false is per-entry. Without it JSZip synthesises directory
  // entries stamped with the current time regardless of the date above, and
  // regeneration stops being byte-identical whenever a run crosses a second.
  const at = { date: FIXED_DATE, createFolders: false };

  zip.file("[Content_Types].xml", `${BASE_CONTENT_TYPES}${overrides}\n</Types>`, at);
  zip.file("_rels/.rels", ROOT_RELS, at);
  zip.file("word/document.xml", documentXml, at);
  zip.file(
    "word/_rels/document.xml.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">\n  ${rels.join("\n  ")}\n</Relationships>`,
    at
  );
  zip.file("word/styles.xml", STYLES, at);

  if (hasHeader) {
    zip.file("word/header1.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:hdr ${W_NS}>${para(run(doc.header!))}</w:hdr>`, at);
  }
  if (hasFooter) {
    zip.file("word/footer1.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:ftr ${W_NS}>${para(run(doc.footer!))}</w:ftr>`, at);
  }

  return zip.generateAsync({ type: "uint8array" });
}
