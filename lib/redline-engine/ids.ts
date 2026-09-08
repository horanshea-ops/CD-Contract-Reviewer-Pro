import type { ParsedPart } from "../docx";

/**
 * Revision ids (MASTER_PLAN.md §1.5.9).
 *
 * Must be unique across the whole package, including against the
 * counterparty's revisions — Word's accept and reject go wrong when two
 * revisions share an id, and §1.6 fails the export for it.
 *
 * Every `w:id` in every part is scanned, not just the ones on revision
 * elements. Bookmarks and content controls carry ids from the same space, and
 * starting above all of them costs nothing.
 */
export class RevisionIds {
  private next: number;
  private issued: string[] = [];

  constructor(parts: ParsedPart[]) {
    let highest = 0;
    for (const part of parts) {
      for (const m of part.xml.matchAll(/\bw:id="(\d+)"/g)) {
        const n = Number(m[1]);
        if (Number.isFinite(n) && n > highest) highest = n;
      }
    }
    this.next = Math.max(highest + 1, 1000);
  }

  take(): number {
    const id = this.next++;
    this.issued.push(String(id));
    return id;
  }

  /** The ids this run wrote, for §1.6 to attribute revisions by id rather than by name. */
  get ownRevisionIds(): string[] {
    return [...this.issued];
  }
}
