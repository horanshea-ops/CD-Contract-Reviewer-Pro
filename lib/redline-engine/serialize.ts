import { XMLSerializer } from "@xmldom/xmldom";
import type { ParsedPart } from "../docx";

/**
 * Writing an edited part back into the package.
 *
 * Only parts that were actually edited are serialized. Everything else —
 * styles, numbering, settings, fonts, the document properties — is copied
 * through untouched, so a round trip cannot change a document in a way nobody
 * asked for.
 *
 * Measured before this was built: parsing and re-serializing a part changes
 * nothing except the line ending after the XML declaration, on real Word and
 * Google Docs files up to 214KB. That one character is preserved here by
 * keeping the original prolog verbatim and appending the serialized root, so
 * an edited part differs from the original only where it was edited.
 */

const PROLOG = /^(\s*<\?xml[^>]*\?>[\r\n]*)/;

/** xmldom serializes its own node type, which is not the DOM lib's. */
type SerializableNode = Parameters<XMLSerializer["serializeToString"]>[0];

export function serializePart(part: ParsedPart): string {
  const root = part.doc.documentElement;
  if (!root) return part.xml;
  const body = new XMLSerializer().serializeToString(root as unknown as SerializableNode);
  const prolog = PROLOG.exec(part.xml)?.[1] ?? "";
  return prolog + body;
}
