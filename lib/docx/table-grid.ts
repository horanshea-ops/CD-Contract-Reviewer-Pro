import { loadDocx } from "./parts";

/**
 * Column widths and merged cells for each top-level table in the document
 * body, in document order.
 *
 * Extraction keeps a table's text but not its geometry, so a PDF drawn from
 * extraction alone has to guess column widths and cannot tell a merged cell
 * from a short row. Word records both, in `w:tblGrid` and `w:gridSpan`.
 */

export interface TableGrid {
  /** Each grid column's width, in twentieths of a point. */
  columns: number[];
  /** Per row, how many grid columns each cell spans. */
  rows: number[][];
}

const children = (el: Element, name: string): Element[] => {
  const out: Element[] = [];
  for (let i = 0; i < el.childNodes.length; i++) {
    const c = el.childNodes[i];
    if (c.nodeType === 1 && (c as Element).nodeName === name) out.push(c as Element);
  }
  return out;
};

function insideTable(el: Element): boolean {
  let node = el.parentNode;
  while (node && node.nodeType === 1) {
    if ((node as Element).nodeName === "w:tbl") return true;
    node = node.parentNode;
  }
  return false;
}

/** Cells of a row, including any wrapped in a content control. */
function cellsOf(row: Element): Element[] {
  const out: Element[] = [];
  for (let i = 0; i < row.childNodes.length; i++) {
    const c = row.childNodes[i] as Element;
    if (c.nodeType !== 1) continue;
    if (c.nodeName === "w:tc") out.push(c);
    else if (c.nodeName === "w:sdt") for (const content of children(c, "w:sdtContent")) out.push(...children(content, "w:tc"));
  }
  return out;
}

function spanOf(cell: Element): number {
  const tcPr = children(cell, "w:tcPr")[0];
  const span = tcPr ? children(tcPr, "w:gridSpan")[0] : undefined;
  const n = Number(span?.getAttribute("w:val"));
  return Number.isInteger(n) && n > 0 ? n : 1;
}

export async function tableGrids(docxBytes: Uint8Array): Promise<TableGrid[]> {
  const pkg = await loadDocx(docxBytes);
  const tables = pkg.document.doc.getElementsByTagName("w:tbl");
  const grids: TableGrid[] = [];
  for (let i = 0; i < tables.length; i++) {
    const table = tables[i];
    if (insideTable(table)) continue;
    const grid = children(table, "w:tblGrid")[0];
    const columns = grid ? children(grid, "w:gridCol").map((c) => Number(c.getAttribute("w:w")) || 0) : [];
    const rows = children(table, "w:tr").map((row) => cellsOf(row).map(spanOf));
    grids.push({ columns, rows });
  }
  return grids;
}
