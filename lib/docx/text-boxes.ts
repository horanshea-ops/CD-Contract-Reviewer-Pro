/**
 * Text boxes, which Word usually stores twice: a modern copy inside
 * `mc:Choice` and a copy for older programs inside `mc:Fallback`. The reader
 * takes one copy and leaves the other, so a box's wording is read once.
 */

const elementChildren = (node: Element): Element[] => {
  const out: Element[] = [];
  for (let i = 0; i < node.childNodes.length; i++) {
    const c = node.childNodes[i];
    if (c.nodeType === 1) out.push(c as Element);
  }
  return out;
};

const named = (node: Element, name: string) => elementChildren(node).filter((c) => c.nodeName === name);

const holdsBox = (branch: Element) => branch.getElementsByTagName("w:txbxContent").length > 0;

/**
 * The one branch of an `mc:AlternateContent` the reader takes. The modern
 * copy wins, unless only the older copy holds a text box.
 */
export function branchRead(alternate: Element): Element | null {
  const modern = named(alternate, "mc:Choice");
  const older = named(alternate, "mc:Fallback");
  return modern.find(holdsBox) ?? older.find(holdsBox) ?? modern[0] ?? older[0] ?? null;
}

/** The outermost text boxes under a node, one copy of each. A box inside a box is found when the outer one is read. */
export function textBoxesIn(node: Element): Element[] {
  if (node.nodeName === "w:txbxContent") return [node];
  if (node.nodeName !== "mc:AlternateContent") return elementChildren(node).flatMap(textBoxesIn);
  const branch = branchRead(node);
  return branch ? textBoxesIn(branch) : [];
}

/** True for anything inside the copy of a box that the reader leaves. */
export function inSkippedCopy(node: Element): boolean {
  let branch: Element | null = null;
  for (let at = node.parentNode as Element | null; at && at.nodeType === 1; at = at.parentNode as Element | null) {
    if (at.nodeName === "mc:AlternateContent" && branch && branchRead(at) !== branch) return true;
    branch = at.nodeName === "mc:Choice" || at.nodeName === "mc:Fallback" ? at : null;
  }
  return false;
}
