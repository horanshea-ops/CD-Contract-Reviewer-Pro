import type { ParsedPart } from "./parts";

/**
 * Resolves real list numbers from word/numbering.xml (MASTER_PLAN.md §1.4.5).
 *
 * Emitting "1.", "1.a", "1.a.i" rather than dropping the numbering matters
 * because contracts cross-reference by number: a finding that says "the
 * obligation in 1.a" is meaningless if the model only ever saw bare paragraphs.
 */

interface LevelDef {
  numFmt: string;
  lvlText: string;
  start: number;
}

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
  /** numId -> ilvl -> definition */
  private levels = new Map<string, Map<number, LevelDef>>();
  /** numId -> ilvl -> current counter */
  private counters = new Map<string, Map<number, number>>();

  constructor(numbering: ParsedPart | null) {
    if (!numbering) return;

    const abstracts = new Map<string, Map<number, LevelDef>>();
    const absNodes = numbering.doc.getElementsByTagName("w:abstractNum");
    for (let i = 0; i < absNodes.length; i++) {
      const abs = absNodes[i];
      const absId = abs.getAttribute("w:abstractNumId");
      if (!absId) continue;
      const byLevel = new Map<number, LevelDef>();
      const lvls = abs.getElementsByTagName("w:lvl");
      for (let j = 0; j < lvls.length; j++) {
        const lvl = lvls[j];
        const ilvl = Number(lvl.getAttribute("w:ilvl") ?? j);
        const get = (tag: string) => lvl.getElementsByTagName(tag)[0]?.getAttribute("w:val") ?? null;
        byLevel.set(ilvl, {
          numFmt: get("w:numFmt") ?? "decimal",
          lvlText: get("w:lvlText") ?? "%1.",
          start: Number(get("w:start") ?? "1"),
        });
      }
      abstracts.set(absId, byLevel);
    }

    const numNodes = numbering.doc.getElementsByTagName("w:num");
    for (let i = 0; i < numNodes.length; i++) {
      const num = numNodes[i];
      const numId = num.getAttribute("w:numId");
      const absId = num.getElementsByTagName("w:abstractNumId")[0]?.getAttribute("w:val");
      if (!numId || !absId) continue;
      const byLevel = abstracts.get(absId);
      if (byLevel) this.levels.set(numId, byLevel);
    }
  }

  /**
   * Advances the counter for this list level and renders its label, e.g. "1.a".
   * Returns "" when the numbering is unknown, so the caller emits nothing
   * rather than a misleading number.
   */
  next(numId: string, ilvl: number): string {
    const byLevel = this.levels.get(numId);
    const def = byLevel?.get(ilvl);
    if (!def) return "";

    let counters = this.counters.get(numId);
    if (!counters) { counters = new Map(); this.counters.set(numId, counters); }

    counters.set(ilvl, (counters.get(ilvl) ?? def.start - 1) + 1);
    // Descending a level restarts everything below it, as Word does.
    for (const deeper of [...counters.keys()]) if (deeper > ilvl) counters.delete(deeper);

    return def.lvlText.replace(/%(\d)/g, (_m, d: string) => {
      const level = Number(d) - 1;
      const levelDef = byLevel?.get(level);
      const value = counters!.get(level) ?? levelDef?.start ?? 1;
      return formatValue(value, levelDef?.numFmt ?? "decimal");
    });
  }
}
