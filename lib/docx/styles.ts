import type { ParsedPart } from "./parts";

/**
 * What a paragraph's style says about its numbering and its heading level.
 *
 * Word reads both from the style when the paragraph states neither, and a
 * style passes them to the styles based on it. A contract's clause numbers and
 * headings usually live here, not on the paragraph.
 */

interface StyleDef {
  basedOn: string | null;
  numId: string | null;
  ilvl: number | null;
  /** 0 for a top-level heading, as the file stores it. 9 means body text. */
  outline: number | null;
}

const child = (node: Element | null, name: string): Element | null => {
  if (!node) return null;
  for (let i = 0; i < node.childNodes.length; i++) {
    const c = node.childNodes[i] as Element;
    if (c.nodeType === 1 && c.nodeName === name) return c;
  }
  return null;
};
const val = (node: Element | null, name: string) => child(node, name)?.getAttribute("w:val") ?? null;
const num = (s: string | null) => (s === null || s === "" || Number.isNaN(Number(s)) ? null : Number(s));

/** The deepest heading the text and the preview mark. */
const DEEPEST_HEADING = 6;
/** Outline levels 0 to 8 are headings. */
const LAST_OUTLINE_LEVEL = 8;

export class ParagraphStyles {
  private byId = new Map<string, StyleDef>();
  private defaultId: string | null = null;

  constructor(styles: ParsedPart | null) {
    if (!styles) return;
    const nodes = styles.doc.getElementsByTagName("w:style");
    for (let i = 0; i < nodes.length; i++) {
      const style = nodes[i];
      if (style.getAttribute("w:type") !== "paragraph") continue;
      const id = style.getAttribute("w:styleId");
      if (!id) continue;
      const pPr = child(style, "w:pPr");
      const numPr = child(pPr, "w:numPr");
      this.byId.set(id, {
        basedOn: val(style, "w:basedOn"),
        numId: val(numPr, "w:numId"),
        ilvl: num(val(numPr, "w:ilvl")),
        outline: num(val(pPr, "w:outlineLvl")),
      });
      if (style.getAttribute("w:default") === "1") this.defaultId = id;
    }
  }

  /** The paragraph's style, then each style that one is based on. */
  chainOf(pPr: Element | null): string[] {
    const chain: string[] = [];
    let id = val(pPr, "w:pStyle") ?? this.defaultId;
    while (id && !chain.includes(id)) {
      chain.push(id);
      id = this.byId.get(id)?.basedOn ?? null;
    }
    return chain;
  }

  /** The nearest value along the chain. */
  private inherited<K extends "numId" | "ilvl" | "outline">(chain: string[], key: K): StyleDef[K] | null {
    for (const id of chain) {
      const value = this.byId.get(id)?.[key];
      if (value !== null && value !== undefined) return value;
    }
    return null;
  }

  /** The list and level the style numbers its paragraphs in. Either can be absent. */
  numberingOf(chain: string[]): { numId: string | null; ilvl: number | null } {
    return { numId: this.inherited(chain, "numId"), ilvl: this.inherited(chain, "ilvl") };
  }

  /**
   * 1 to 6 for a heading, 0 for body text. The paragraph's own outline level
   * comes first, then its style's, then the style's code name where the file
   * has no style to read.
   */
  headingLevelOf(pPr: Element | null): number {
    const chain = this.chainOf(pPr);
    let outline = num(val(pPr, "w:outlineLvl")) ?? this.inherited(chain, "outline");
    if (outline === null) {
      const named = /^Heading(\d)$/i.exec(val(pPr, "w:pStyle") ?? "");
      if (named) outline = Number(named[1]) - 1;
    }
    if (outline === null || outline < 0 || outline > LAST_OUTLINE_LEVEL) return 0;
    return Math.min(outline + 1, DEEPEST_HEADING);
  }
}
