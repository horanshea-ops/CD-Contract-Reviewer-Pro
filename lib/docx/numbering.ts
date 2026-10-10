import type { ParsedPart } from "./parts";
import { ParagraphStyles } from "./styles";

/**
 * Resolves real list numbers from word/numbering.xml (MASTER_PLAN.md §1.4.5).
 *
 * Emitting "1.", "1.a", "1.a.i" rather than dropping the numbering matters
 * because contracts cross-reference by number: a finding that says "the
 * obligation in 1.a" is meaningless if the model only ever saw bare paragraphs.
 *
 * Word's rules, which this follows:
 *
 *  - A paragraph is numbered by its own setting, or by its style's.
 *  - A list instance (`w:num`) draws its levels from a definition
 *    (`w:abstractNum`), which may only point at a list style that holds them.
 *  - Every instance of one definition shares one count. An instance restarts
 *    the count only where it states a number to restart at.
 */

interface LevelDef {
  numFmt: string;
  lvlText: string;
  start: number;
  /** The paragraph style this level numbers, when the definition names one. */
  pStyle: string | null;
}

/** One `w:num`: the definition it counts in, its levels, and where it restarts. */
interface Instance {
  listId: string;
  levels: Map<number, LevelDef>;
  restarts: Map<number, number>;
}

const children = (node: Element, name: string): Element[] => {
  const out: Element[] = [];
  for (let i = 0; i < node.childNodes.length; i++) {
    const c = node.childNodes[i] as Element;
    if (c.nodeType === 1 && c.nodeName === name) out.push(c);
  }
  return out;
};
const val = (node: Element | undefined, name: string) => (node ? children(node, name)[0]?.getAttribute("w:val") ?? null : null);

function levelsOf(node: Element): Map<number, LevelDef> {
  const byLevel = new Map<number, LevelDef>();
  children(node, "w:lvl").forEach((lvl, j) => {
    byLevel.set(Number(lvl.getAttribute("w:ilvl") ?? j), {
      numFmt: val(lvl, "w:numFmt") ?? "decimal",
      lvlText: val(lvl, "w:lvlText") ?? "%1.",
      start: Number(val(lvl, "w:start") ?? "1"),
      pStyle: val(lvl, "w:pStyle"),
    });
  });
  return byLevel;
}

/** A bullet stored as a symbol-font glyph has no shape of its own outside that font. */
const PRIVATE_USE = /[\uE000-\uF8FF]/;

function romanize(n: number): string {
  const table: Array<[number, string]> = [
    [1000, "m"], [900, "cm"], [500, "d"], [400, "cd"], [100, "c"], [90, "xc"],
    [50, "l"], [40, "xl"], [10, "x"], [9, "ix"], [5, "v"], [4, "iv"], [1, "i"],
  ];
  let out = "";
  for (const [v, s] of table) while (n >= v) { out += s; n -= v; }
  return out;
}

function letterize(n: number): string {
  let out = "";
  while (n > 0) { const r = (n - 1) % 26; out = String.fromCharCode(97 + r) + out; n = Math.floor((n - 1) / 26); }
  return out;
}

function formatValue(n: number, numFmt: string): string {
  switch (numFmt) {
    case "decimalZero": return String(n).padStart(2, "0");
    case "upperLetter": return letterize(n).toUpperCase();
    case "lowerLetter": return letterize(n);
    case "upperRoman": return romanize(n).toUpperCase();
    case "lowerRoman": return romanize(n);
    case "bullet": return "•";
    case "none": return "";
    default: return String(n); // decimal and anything unrecognised
  }
}

export class NumberingResolver {
  /** How each paragraph style numbers and outlines its paragraphs. */
  readonly styles: ParagraphStyles;

  private instances = new Map<string, Instance>();
  /** listId -> ilvl -> current count */
  private counters = new Map<string, Map<number, number>>();
  /** "numId:ilvl" for each restart already taken. */
  private restarted = new Set<string>();

  /**
   * Takes both parts, so every reader of one file numbers it the same way.
   */
  constructor(numbering: ParsedPart | null, styles: ParsedPart | null) {
    this.styles = new ParagraphStyles(styles);
    if (!numbering) return;

    const root = numbering.doc.documentElement as unknown as Element;
    const abstracts = new Map<string, Element>();
    const holderOfStyle = new Map<string, string>();
    for (const abs of children(root, "w:abstractNum")) {
      const absId = abs.getAttribute("w:abstractNumId");
      if (!absId) continue;
      abstracts.set(absId, abs);
      const held = val(abs, "w:styleLink");
      if (held) holderOfStyle.set(held, absId);
    }

    for (const numEl of children(root, "w:num")) {
      const numId = numEl.getAttribute("w:numId");
      let listId = val(numEl, "w:abstractNumId");
      if (!numId || listId === null) continue;

      // A definition with no levels of its own points at the list style that holds them.
      const linked = val(abstracts.get(listId), "w:numStyleLink");
      if (linked && holderOfStyle.has(linked)) listId = holderOfStyle.get(linked)!;
      const abs = abstracts.get(listId);
      if (!abs) continue;

      const levels = levelsOf(abs);
      const restarts = new Map<number, number>();
      for (const override of children(numEl, "w:lvlOverride")) {
        const ilvl = Number(override.getAttribute("w:ilvl") ?? "0");
        for (const [level, def] of levelsOf(override)) levels.set(level, def);
        const restart = val(override, "w:startOverride");
        if (restart !== null) restarts.set(ilvl, Number(restart));
      }
      this.instances.set(numId, { listId, levels, restarts });
    }
  }

  /**
   * The list and level a paragraph is numbered in, or null when it isn't.
   * The paragraph's own setting wins over its style's, and a list id of 0
   * switches numbering off.
   */
  numberingOf(pPr: Element | null): { numId: string; ilvl: number } | null {
    const numPr = pPr ? children(pPr, "w:numPr")[0] : undefined;
    const chain = this.styles.chainOf(pPr);
    const fromStyle = this.styles.numberingOf(chain);

    const numId = val(numPr, "w:numId") ?? fromStyle.numId;
    if (numId === null || numId === "0") return null;

    const own = val(numPr, "w:ilvl");
    const ilvl = own !== null ? Number(own) : (fromStyle.ilvl ?? this.levelNaming(numId, chain) ?? 0);
    return { numId, ilvl };
  }

  /** The level whose definition names one of these styles. */
  private levelNaming(numId: string, chain: string[]): number | null {
    const levels = this.instances.get(numId)?.levels;
    if (!levels) return null;
    for (const id of chain) for (const [ilvl, def] of levels) if (def.pStyle === id) return ilvl;
    return null;
  }

  /**
   * Advances the count for this list level and renders its label, e.g. "1.a".
   * Returns "" where Word shows no marker, and null when the file doesn't
   * define the list, so the caller never emits a misleading number.
   */
  next(numId: string, ilvl: number): string | null {
    const instance = this.instances.get(numId);
    const def = instance?.levels.get(ilvl);
    if (!instance || !def) return null;

    let counters = this.counters.get(instance.listId);
    if (!counters) { counters = new Map(); this.counters.set(instance.listId, counters); }

    const restart = instance.restarts.get(ilvl);
    const key = `${numId}:${ilvl}`;
    if (restart !== undefined && !this.restarted.has(key)) {
      this.restarted.add(key);
      counters.set(ilvl, restart);
    } else {
      counters.set(ilvl, (counters.get(ilvl) ?? def.start - 1) + 1);
    }
    // Descending a level restarts everything below it, as Word does.
    for (const deeper of [...counters.keys()]) if (deeper > ilvl) counters.delete(deeper);

    if (def.numFmt === "bullet") return PRIVATE_USE.test(def.lvlText) ? "•" : def.lvlText.trim();

    return def.lvlText
      .replace(/%(\d)/g, (_m, d: string) => {
        const level = Number(d) - 1;
        const levelDef = instance.levels.get(level);
        const value = counters!.get(level) ?? levelDef?.start ?? 1;
        return formatValue(value, levelDef?.numFmt ?? "decimal");
      })
      .trim();
  }
}
