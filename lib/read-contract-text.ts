import WordExtractor from "word-extractor";
import { extractDocx } from "./docx";
import { contractText } from "./docx/contract-text";
import { extractPdfLines } from "./extract-pdf-lines";
import type { LocatablePart } from "./redline-engine/locate";

/** A contract's text, whole and split the way the locator expects. */
export interface ContractText {
  contract_text: string;
  contract_parts: LocatablePart[];
}

/**
 * Reads a contract's text locally, at no cost. The text is what the model
 * reads for a Word file, and what every quote it gives is checked against.
 */
export async function readContractText(bytes: Uint8Array, format: "pdf" | "docx" | "doc"): Promise<ContractText> {
  if (format === "docx") {
    const extracted = await extractDocx(bytes);

    // Only the text of each part is kept. The parts also carry XML nodes, which can't be stored.
    return { contract_text: contractText(extracted), contract_parts: extracted.parts.map(({ part, text }) => ({ part, text })) };
  }
  if (format === "doc") {
    const text = (await new WordExtractor().extract(Buffer.from(bytes))).getBody();
    return { contract_text: text, contract_parts: [{ part: "document", text }] as LocatablePart[] };
  }
  const text = (await extractPdfLines(bytes.slice())).map((l) => l.text).join("\n");
  return { contract_text: text, contract_parts: [{ part: "document", text }] as LocatablePart[] };
}
