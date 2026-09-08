import JSZip from "jszip";
import { parseXml } from "../docx/parts";

/**
 * Reads a .docx into the form the §1.6.1 checks compare.
 *
 * Deliberately wider than lib/docx/parts.ts, which reads the parts extraction
 * needs. Validation parses *every* XML and .rels entry, because a header that
 * no longer parses is a file Word refuses to open just as surely as a broken
 * word/document.xml.
 *
 * Nothing here throws. A package that cannot be read comes back as a failure to
 * report, since an oracle that crashes on a corrupt document is no oracle.
 */

export interface XmlPart {
  path: string;
  doc: Document;
  /** Root element name: "w:document", "w:hdr", "w:ftr", "w:footnotes", "w:endnotes", ... */
  root: string;
}

export interface ReadPackage {
  zip: JSZip;
  /** File entries, directories excluded. */
  entries: string[];
  /** Parts that parsed, keyed by path. */
  xmlParts: Map<string, XmlPart>;
  /** Parts that did not parse, with the reason. */
  parseErrors: { path: string; message: string }[];
  /** The parts carrying contract text, in a stable order. */
  textParts: XmlPart[];
}

export type ReadResult = { ok: true; pkg: ReadPackage } | { ok: false; error: string };

/** Root elements that hold contract language. Headers and footers routinely carry terms. */
const TEXT_ROOTS = new Set(["w:document", "w:hdr", "w:ftr", "w:footnotes", "w:endnotes"]);

const isXmlEntry = (path: string) => /\.(xml|rels)$/i.test(path);

export async function readPackage(bytes: Uint8Array | Buffer): Promise<ReadResult> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(bytes);
  } catch (e) {
    return { ok: false, error: `The file is not a readable Word archive: ${(e as Error).message}` };
  }

  const entries: string[] = [];
  for (const [path, file] of Object.entries(zip.files)) {
    if (!file.dir) entries.push(path);
  }
  entries.sort();

  const xmlParts = new Map<string, XmlPart>();
  const parseErrors: { path: string; message: string }[] = [];

  for (const path of entries) {
    if (!isXmlEntry(path)) continue;
    let xml: string;
    try {
      xml = await zip.file(path)!.async("string");
    } catch (e) {
      parseErrors.push({ path, message: (e as Error).message });
      continue;
    }
    try {
      const doc = parseXml(xml, path);
      xmlParts.set(path, { path, doc, root: doc.documentElement?.nodeName ?? "" });
    } catch (e) {
      parseErrors.push({ path, message: (e as Error).message });
    }
  }

  // document.xml first, then everything else alphabetically, so mismatch
  // reports name the part an associate would look at first.
  const textParts = [...xmlParts.values()]
    .filter((p) => TEXT_ROOTS.has(p.root))
    .sort((a, b) => {
      if (a.path === "word/document.xml") return -1;
      if (b.path === "word/document.xml") return 1;
      return a.path.localeCompare(b.path);
    });

  return { ok: true, pkg: { zip, entries, xmlParts, parseErrors, textParts } };
}

// --- small DOM helpers, shared by the checks and the view builder ----------

export function childElements(node: Element): Element[] {
  const out: Element[] = [];
  for (let i = 0; i < node.childNodes.length; i++) {
    const c = node.childNodes[i];
    if (c.nodeType === 1) out.push(c as Element);
  }
  return out;
}

export function elementsByTag(doc: Document, tag: string): Element[] {
  const nodes = doc.getElementsByTagName(tag);
  const out: Element[] = [];
  for (let i = 0; i < nodes.length; i++) out.push(nodes[i]);
  return out;
}

export const REVISION_TAGS = ["w:ins", "w:del", "w:moveFrom", "w:moveTo"] as const;
export type RevisionTag = (typeof REVISION_TAGS)[number];

export function isRevisionTag(name: string): name is RevisionTag {
  return (REVISION_TAGS as readonly string[]).includes(name);
}

export interface RevisionEl {
  el: Element;
  tag: RevisionTag;
  id: string;
  author: string;
  path: string;
}

/**
 * Every revision element in the package.
 *
 * A `w:ins` inside `w:rPr` is a paragraph-mark revision, not a content one: it
 * carries an id like any other and so counts for uniqueness, but it wraps no
 * text.
 */
export function allRevisions(pkg: ReadPackage): RevisionEl[] {
  const out: RevisionEl[] = [];
  for (const part of pkg.xmlParts.values()) {
    for (const tag of REVISION_TAGS) {
      for (const el of elementsByTag(part.doc, tag)) {
        out.push({
          el,
          tag,
          id: el.getAttribute("w:id") ?? "",
          author: el.getAttribute("w:author") ?? "",
          path: part.path,
        });
      }
    }
  }
  return out;
}
