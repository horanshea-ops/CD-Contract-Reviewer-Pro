/**
 * Where each section of a contract starts and ends.
 *
 * §1.4 marks a heading with `#` and a numbered clause with its resolved number,
 * so both are visible in the extracted text. Reading structure from those
 * markers rather than from the raw text matters: searching a real contract for
 * "2" hits dates, dollar amounts and room counts, and the nearest one wins,
 * which is a confident answer to the wrong question.
 *
 * §1.5 uses this to tell two copies of the same wording apart. §2.1.1 uses it
 * to say which clause a changed region falls in.
 */

export interface Section {
  /** Offset of the heading's first character in the text it was found in. */
  start: number;
  /** Offset just past the section's last character — the next section's start, or the end. */
  end: number;
  /** "5.2" from "5.2 Attrition", when the section is numbered. */
  number: string | null;
  /** The heading line as written, after its `#` marks or its number. */
  label: string;
  /** 1 for a top-level section, deeper for "5.2.1" or a Heading3. */
  depth: number;
}

/** The number a section reference opens with, if it opens with one. */
export function leadingNumber(s: string): string | null {
  return s.match(/^\s*(\d+(?:\.\d+)*)/)?.[1] ?? null;
}

export function outlineOf(text: string): Section[] {
  const found: Omit<Section, "end">[] = [];

  // A heading, marked with the extractor's own hashes.
  for (const m of text.matchAll(/^(#{1,6})[ \t]+(.+)$/gm)) {
    const label = m[2].trim();
    found.push({ start: m.index, label, number: leadingNumber(label), depth: m[1].length });
  }
  // A numbered clause, which carries its number rather than a heading style.
  for (const m of text.matchAll(/^[ \t]*(\d+(?:\.\d+)*)[.)][ \t]+(.+)$/gm)) {
    found.push({ start: m.index, label: m[2].trim(), number: m[1], depth: m[1].split(".").length });
  }

  found.sort((a, b) => a.start - b.start);
  return found.map((section, i) => ({ ...section, end: found[i + 1]?.start ?? text.length }));
}

/**
 * The section an offset falls in, or null when it sits above the first heading —
 * a recitals block or a preamble, which belongs to no clause.
 */
export function sectionAt(sections: Section[], offset: number): Section | null {
  let lo = 0;
  let hi = sections.length - 1;
  let found: Section | null = null;

  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (sections[mid].start <= offset) {
      found = sections[mid];
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found && offset < found.end ? found : null;
}
