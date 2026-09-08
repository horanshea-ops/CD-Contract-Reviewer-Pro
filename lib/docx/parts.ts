import JSZip from "jszip";
import { DOMParser } from "@xmldom/xmldom";

/**
 * Reads a .docx archive and parses the parts extraction cares about
 * (MASTER_PLAN.md §1.4.1).
 *
 * Headers and footers are discovered through the relationships file rather than
 * guessed by filename, and are treated as first-class parts with their own
 * text and their own maps. Hotels routinely put the cutoff date and the
 * cancellation notice address in a header, and the current pipeline never reads
 * them at all.
 */

export interface ParsedPart {
  /** "document", "header1", "footer2", "footnotes", ... */
  name: string;
  /** Path inside the archive, e.g. "word/header1.xml". */
  path: string;
  xml: string;
  doc: Document;
}

export interface DocxPackage {
  zip: JSZip;
  /** word/document.xml — always present in a valid package. */
  document: ParsedPart;
  /** Headers and footers, in relationship order. */
  headersFooters: ParsedPart[];
  /** Present only if the document has them. */
  numbering: ParsedPart | null;
  styles: ParsedPart | null;
  /** Every part above, document first — the set extraction walks. */
  textParts: ParsedPart[];
  /** Names of entries in the archive, for the archive-integrity check. */
  entries: string[];
}

export class DocxParseError extends Error {}

/** Strict parse. xmldom throws on a mismatched tag and reports other faults, so both paths raise. */
export function parseXml(xml: string, path: string): Document {
  const errors: string[] = [];
  const parser = new DOMParser({
    onError: (level: string, msg: unknown) => {
      // xmldom reports recoverable issues as warnings; only errors matter here.
      if (level !== "warning") errors.push(String(msg));
    },
  });
  let doc: Document;
  try {
    doc = parser.parseFromString(xml, "text/xml") as unknown as Document;
  } catch (e) {
    // A mismatched tag is thrown rather than reported.
    throw new DocxParseError(`${path} is not well-formed XML: ${(e as Error).message}`);
  }
  if (errors.length) throw new DocxParseError(`${path} is not well-formed XML: ${errors[0]}`);
  return doc;
}

const HEADER_REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/header";
const FOOTER_REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer";

/** Turns "word/header1.xml" into "header1". */
function partNameFromPath(path: string): string {
  const base = path.split("/").pop() ?? path;
  return base.replace(/\.xml$/, "");
}

async function readPart(zip: JSZip, path: string): Promise<ParsedPart | null> {
  const file = zip.file(path);
  if (!file) return null;
  const xml = await file.async("string");
  return { name: partNameFromPath(path), path, xml, doc: parseXml(xml, path) };
}

export async function loadDocx(bytes: Uint8Array | Buffer): Promise<DocxPackage> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(bytes);
  } catch (e) {
    throw new DocxParseError(`Not a readable .docx archive: ${(e as Error).message}`);
  }

  const entries = Object.keys(zip.files);

  const document = await readPart(zip, "word/document.xml");
  if (!document) throw new DocxParseError("word/document.xml is missing — not a Word document.");

  // Headers and footers come from the relationships file so that a document
  // using header3.xml without header1.xml is still read correctly.
  const headersFooters: ParsedPart[] = [];
  const rels = zip.file("word/_rels/document.xml.rels");
  if (rels) {
    const relsXml = await rels.async("string");
    const relsDoc = parseXml(relsXml, "word/_rels/document.xml.rels");
    const nodes = relsDoc.getElementsByTagName("Relationship");
    for (let i = 0; i < nodes.length; i++) {
      const el = nodes[i];
      const type = el.getAttribute("Type");
      if (type !== HEADER_REL && type !== FOOTER_REL) continue;
      const target = el.getAttribute("Target");
      if (!target || /^https?:/i.test(target)) continue;
      const path = target.startsWith("/") ? target.slice(1) : `word/${target}`;
      const part = await readPart(zip, path);
      if (part) headersFooters.push(part);
    }
  }

  return {
    zip,
    document,
    headersFooters,
    numbering: await readPart(zip, "word/numbering.xml"),
    styles: await readPart(zip, "word/styles.xml"),
    textParts: [document, ...headersFooters],
    entries,
  };
}
