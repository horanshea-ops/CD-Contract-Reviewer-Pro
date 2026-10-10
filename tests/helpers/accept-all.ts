import { loadDocx } from "@/lib/docx";
import { acceptRevisionsIn } from "@/lib/docx-accept";
import { serializePart } from "@/lib/redline-engine/serialize";

/** The file with every tracked change accepted, whoever made it. */
export async function acceptAll(bytes: Uint8Array): Promise<Uint8Array> {
  const pkg = await loadDocx(bytes);
  for (const part of pkg.textParts) {
    acceptRevisionsIn(part.doc, () => true);
    pkg.zip.file(part.path, serializePart(part));
  }
  return pkg.zip.generateAsync({ type: "uint8array" });
}
