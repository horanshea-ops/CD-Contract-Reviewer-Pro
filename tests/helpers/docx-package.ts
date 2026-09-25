import JSZip from "jszip";

/**
 * Minimal .docx packages, built by hand so a test can violate one invariant at
 * a time. Lifted from scripts/fuzz-tracked-changes.ts, which needs the same
 * thing, and shared so the two do not drift.
 */

export const W_NS =
  'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
  'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';

export const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** A run of ordinary text. */
export const run = (text: string) => `<w:r><w:t xml:space="preserve">${esc(text)}</w:t></w:r>`;

/** A run of deleted text, as it must be stored inside a w:del. */
export const delRun = (text: string) =>
  `<w:r><w:delText xml:space="preserve">${esc(text)}</w:delText></w:r>`;

export const para = (inner: string, pPr = "") => `<w:p>${pPr}${inner}</w:p>`;

export const ins = (id: number, author: string, inner: string) =>
  `<w:ins w:id="${id}" w:author="${esc(author)}" w:date="2026-03-01T00:00:00Z">${inner}</w:ins>`;

export const del = (id: number, author: string, inner: string) =>
  `<w:del w:id="${id}" w:author="${esc(author)}" w:date="2026-03-01T00:00:00Z">${inner}</w:del>`;

/** A paragraph whose paragraph mark is itself marked as inserted. */
export const insertedPara = (id: number, author: string, inner: string) =>
  para(
    inner,
    `<w:pPr><w:rPr><w:ins w:id="${id}" w:author="${esc(author)}" w:date="2026-03-01T00:00:00Z"/></w:rPr></w:pPr>`
  );

export function table(rows: string[][]): string {
  const cols = Math.max(...rows.map((r) => r.length));
  const grid = `<w:tblGrid>${Array.from({ length: cols }, () => `<w:gridCol w:w="2000"/>`).join("")}</w:tblGrid>`;
  const body = rows
    .map(
      (cells) =>
        `<w:tr>${cells
          .map((c) => `<w:tc><w:tcPr><w:tcW w:w="2000" w:type="dxa"/></w:tcPr>${para(run(c))}</w:tc>`)
          .join("")}</w:tr>`
    )
    .join("");
  return `<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/></w:tblPr>${grid}${body}</w:tbl>`;
}

export function documentXml(body: string, sectPrExtra = ""): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document ${W_NS}><w:body>${body}<w:sectPr>${sectPrExtra}<w:pgSz w:w="12240" w:h="15840"/></w:sectPr></w:body></w:document>`;
}

export function headerXml(body: string): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:hdr ${W_NS}>${body}</w:hdr>`;
}

export const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;

export const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`;

export const DOC_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>`;

/** Zips an arbitrary set of parts. Pass `overrides` to break one deliberately. */
export async function zipParts(parts: Record<string, string | Uint8Array>): Promise<Uint8Array> {
  const zip = new JSZip();
  const at = { date: new Date("2026-01-01T00:00:00Z"), createFolders: false };
  for (const [path, content] of Object.entries(parts)) zip.file(path, content, at);
  return zip.generateAsync({ type: "uint8array" });
}

/** A well-formed package around one document body. */
export async function buildDocx(
  body: string,
  extra: Record<string, string | Uint8Array> = {}
): Promise<Uint8Array> {
  return zipParts({
    "[Content_Types].xml": CONTENT_TYPES,
    "_rels/.rels": ROOT_RELS,
    "word/document.xml": documentXml(body),
    "word/_rels/document.xml.rels": DOC_RELS,
    ...extra,
  });
}

/**
 * A three-level numbering definition — "1.", "1.a", "1.a.i" — matching the one
 * fixture 07 uses, so a test can exercise real resolved list numbers rather
 * than the unnumbered fallback.
 */
export const NUMBERING_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:numbering ${W_NS}>
  <w:abstractNum w:abstractNumId="0">
    <w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/></w:lvl>
    <w:lvl w:ilvl="1"><w:start w:val="1"/><w:numFmt w:val="lowerLetter"/><w:lvlText w:val="%1.%2"/></w:lvl>
    <w:lvl w:ilvl="2"><w:start w:val="1"/><w:numFmt w:val="lowerRoman"/><w:lvlText w:val="%1.%2.%3"/></w:lvl>
  </w:abstractNum>
  <w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>
</w:numbering>`;

/** A paragraph in that list, at the given level. */
export const numbered = (inner: string, level = 0) =>
  para(inner, `<w:pPr><w:numPr><w:ilvl w:val="${level}"/><w:numId w:val="1"/></w:numPr></w:pPr>`);

/** Relationships for the document part. DOC_RELS is self-closing, so build them. */
export function docRelsXml(rels: { id: string; type: string; target: string }[]): string {
  const entries = rels
    .map((r) => `<Relationship Id="${r.id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${r.type}" Target="${r.target}"/>`)
    .join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${entries}</Relationships>`;
}

const contentTypesWith = (override: string) =>
  CONTENT_TYPES.replace("</Types>", `${override}</Types>`);

/** A package whose paragraphs can carry resolved list numbers. */
export async function buildNumberedDocx(body: string): Promise<Uint8Array> {
  return buildDocx(body, {
    "[Content_Types].xml": contentTypesWith(
      `<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>`
    ),
    "word/_rels/document.xml.rels": docRelsXml([
      { id: "rId2", type: "numbering", target: "numbering.xml" },
    ]),
    "word/numbering.xml": NUMBERING_XML,
  });
}

/** A package with one header wired up, for terms that live outside the body. */
export async function buildHeaderDocx(body: string, headerBody: string): Promise<Uint8Array> {
  return zipParts({
    "[Content_Types].xml": contentTypesWith(
      `<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>`
    ),
    "_rels/.rels": ROOT_RELS,
    "word/document.xml": documentXml(body, `<w:headerReference w:type="default" r:id="rId2"/>`),
    "word/_rels/document.xml.rels": docRelsXml([{ id: "rId2", type: "header", target: "header1.xml" }]),
    "word/header1.xml": headerXml(headerBody),
  });
}
