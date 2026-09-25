/**
 * Tables in the stored review text, where "|" separates cells and "#" marks
 * a heading. Each table keeps the last heading above it.
 */

export interface Table {
  heading: string | null;
  rows: string[][];
}

export function tables(text: string): Table[] {
  const found: Table[] = [];
  let heading: string | null = null;
  let current: string[][] | null = null;

  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("|")) {
      const cells = trimmed.replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
      if (cells.every((c) => /^-{3,}$/.test(c))) continue;
      (current ??= []).push(cells);
      continue;
    }
    if (current) {
      found.push({ heading, rows: current });
      current = null;
    }
    const h = trimmed.match(/^#+\s+(.+)$/);
    if (h && h[1].trim()) heading = h[1].trim();
  }
  if (current) found.push({ heading, rows: current });
  return found;
}
