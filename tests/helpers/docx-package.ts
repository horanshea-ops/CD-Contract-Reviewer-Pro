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

export function documentXml(body: string): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document ${W_NS}><w:body>${body}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/></w:sectPr></w:body></w:document>`;
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
export async function zipParts(parts: Record<string, string>): Promise<Uint8Array> {
  const zip = new JSZip();
  const at = { date: new Date("2026-01-01T00:00:00Z"), createFolders: false };
  for (const [path, content] of Object.entries(parts)) zip.file(path, content, at);
  return zip.generateAsync({ type: "uint8array" });
}

/** A well-formed package around one document body. */
export async function buildDocx(
  body: string,
  extra: Record<string, string> = {}
): Promise<Uint8Array> {
  return zipParts({
    "[Content_Types].xml": CONTENT_TYPES,
    "_rels/.rels": ROOT_RELS,
    "word/document.xml": documentXml(body),
    "word/_rels/document.xml.rels": DOC_RELS,
    ...extra,
  });
}
