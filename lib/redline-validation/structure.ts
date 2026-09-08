import type { CheckResult } from "./types";
import {
  childElements,
  elementsByTag,
  isRevisionTag,
  allRevisions,
  type ReadPackage,
} from "./package";

/**
 * Structural validation of a marked-up document (MASTER_PLAN.md §1.6.1).
 *
 * Each check answers one question about the output on its own, or about the
 * output against the input it was built from. Every one of them has a test that
 * feeds it a document built to violate it — a check nothing can fail is worse
 * than no check, because it reads as reassurance.
 */

const MAX_REVISION_ID = 2147483647; // Word stores w:id as a signed 32-bit int.

const pass = (name: CheckResult["name"], detail: string): CheckResult => ({ name, passed: true, detail });
const fail = (name: CheckResult["name"], detail: string): CheckResult => ({ name, passed: false, detail });

/** Every XML part in the output is well-formed. A part that does not parse is a file Word will not open. */
export function checkPartsParse(output: ReadPackage): CheckResult {
  if (output.parseErrors.length === 0) {
    return pass("parts_parse", `All ${output.xmlParts.size} document parts are well-formed.`);
  }
  const first = output.parseErrors[0];
  return fail(
    "parts_parse",
    `${first.path} is damaged and Word would refuse to open the file: ${first.message}` +
      (output.parseErrors.length > 1 ? ` (${output.parseErrors.length - 1} other parts also failed)` : "")
  );
}

/** No part of the original went missing on the way through. */
export function checkPartsPreserved(input: ReadPackage, output: ReadPackage): CheckResult {
  const have = new Set(output.entries);
  const missing = input.entries.filter((e) => !have.has(e));
  if (missing.length === 0) {
    return pass("parts_preserved", `All ${input.entries.length} parts of the original are still present.`);
  }
  return fail(
    "parts_preserved",
    `${missing.length} part(s) of the original document were lost: ${missing.slice(0, 3).join(", ")}.`
  );
}

/** Every part is declared in [Content_Types].xml, and every declaration points at a part that exists. */
export function checkContentTypes(output: ReadPackage): CheckResult {
  const ct = output.xmlParts.get("[Content_Types].xml");
  if (!ct) return fail("content_types_consistent", "[Content_Types].xml is missing, so Word cannot read the file.");

  const defaults = new Set<string>();
  for (const el of elementsByTag(ct.doc, "Default")) {
    const ext = el.getAttribute("Extension");
    if (ext) defaults.add(ext.toLowerCase());
  }
  const overrides = new Set<string>();
  for (const el of elementsByTag(ct.doc, "Override")) {
    const part = el.getAttribute("PartName");
    if (part) overrides.add(part);
  }

  const undeclared: string[] = [];
  for (const entry of output.entries) {
    if (entry === "[Content_Types].xml") continue;
    if (overrides.has(`/${entry}`)) continue;
    const ext = entry.includes(".") ? entry.split(".").pop()!.toLowerCase() : "";
    if (ext && defaults.has(ext)) continue;
    undeclared.push(entry);
  }
  if (undeclared.length) {
    return fail(
      "content_types_consistent",
      `${undeclared.length} part(s) are not declared in [Content_Types].xml: ${undeclared.slice(0, 3).join(", ")}.`
    );
  }

  const have = new Set(output.entries);
  const dangling = [...overrides].filter((p) => !have.has(p.replace(/^\//, "")));
  if (dangling.length) {
    return fail(
      "content_types_consistent",
      `[Content_Types].xml declares ${dangling.length} part(s) that are not in the file: ${dangling.slice(0, 3).join(", ")}.`
    );
  }

  return pass("content_types_consistent", "Every part is declared and every declaration resolves.");
}

/** Resolves a relationship target against the directory owning its .rels file. */
function resolveTarget(relsPath: string, target: string): string {
  if (target.startsWith("/")) return target.slice(1);
  // "word/_rels/document.xml.rels" -> "word/";  "_rels/.rels" -> ""
  const base = relsPath.replace(/_rels\/[^/]*$/, "");
  const segments = (base + target).split("/");
  const out: string[] = [];
  for (const seg of segments) {
    if (seg === "." || seg === "") continue;
    if (seg === "..") out.pop();
    else out.push(seg);
  }
  return out.join("/");
}

/** Every internal relationship points at a part that is actually in the archive. */
export function checkRelationships(output: ReadPackage): CheckResult {
  const have = new Set(output.entries);
  const broken: string[] = [];
  let checked = 0;

  for (const [path, part] of output.xmlParts) {
    if (!path.endsWith(".rels")) continue;
    for (const el of elementsByTag(part.doc, "Relationship")) {
      if (el.getAttribute("TargetMode") === "External") continue;
      const target = el.getAttribute("Target");
      if (!target || /^[a-z][a-z0-9+.-]*:/i.test(target)) continue; // absolute URI, not a part
      checked++;
      const resolved = resolveTarget(path, target.split("#")[0]);
      if (!have.has(resolved)) broken.push(`${path} -> ${target}`);
    }
  }

  if (broken.length) {
    return fail(
      "relationships_resolve",
      `${broken.length} internal link(s) point at parts that are not in the file: ${broken.slice(0, 3).join(", ")}.`
    );
  }
  return pass("relationships_resolve", `All ${checked} internal links resolve.`);
}

/** Revision ids are unique across the whole package and within the range Word stores them in. */
export function checkRevisionIds(output: ReadPackage): CheckResult {
  const revisions = allRevisions(output);
  const seen = new Map<string, string>();
  const duplicates: string[] = [];
  const outOfRange: string[] = [];

  for (const rev of revisions) {
    if (!rev.id) {
      outOfRange.push(`${rev.tag} in ${rev.path} has no id`);
      continue;
    }
    const n = Number(rev.id);
    if (!Number.isInteger(n) || n < 0 || n > MAX_REVISION_ID) outOfRange.push(`${rev.tag} id ${rev.id}`);
    const prior = seen.get(rev.id);
    if (prior) duplicates.push(`id ${rev.id} used by ${prior} and ${rev.tag}`);
    else seen.set(rev.id, rev.tag);
  }

  if (duplicates.length) {
    return fail(
      "revision_ids_unique",
      `${duplicates.length} tracked change(s) share an id, which makes Word's accept and reject unreliable: ${duplicates[0]}.`
    );
  }
  if (outOfRange.length) {
    return fail("revision_ids_unique", `A tracked change has an id Word cannot store: ${outOfRange[0]}.`);
  }
  return pass("revision_ids_unique", `All ${revisions.length} tracked changes have unique, valid ids.`);
}

/**
 * Deleted text is stored as `w:delText` and inserted text as `w:t`.
 *
 * Attribution is by the *nearest* enclosing revision, so a deletion nested
 * inside the property's own insertion stays legal — that nesting is exactly
 * what §1.5.7 needs to be able to do.
 */
export function checkRevisionMarks(output: ReadPackage): CheckResult {
  const problems: string[] = [];

  function walk(el: Element, nearest: "ins" | "del" | null, path: string) {
    for (const child of childElements(el)) {
      const name = child.nodeName;
      if (isRevisionTag(name)) {
        walk(child, name === "w:del" || name === "w:moveFrom" ? "del" : "ins", path);
        continue;
      }
      if (name === "w:r") {
        for (const grand of childElements(child)) {
          if (grand.nodeName === "w:t" && nearest === "del") {
            problems.push(`${path}: deleted text stored as normal text ("${(grand.textContent ?? "").slice(0, 30)}")`);
          }
          if (grand.nodeName === "w:delText" && nearest !== "del") {
            problems.push(`${path}: deleted-text markup outside a deletion ("${(grand.textContent ?? "").slice(0, 30)}")`);
          }
        }
        continue;
      }
      walk(child, nearest, path);
    }
  }

  for (const part of output.textParts) {
    if (part.doc.documentElement) walk(part.doc.documentElement, null, part.path);
  }

  if (problems.length) {
    return fail(
      "revision_marks_wellformed",
      `${problems.length} tracked change(s) are malformed and would display or reject incorrectly in Word: ${problems[0]}.`
    );
  }
  return pass("revision_marks_wellformed", "Insertions and deletions are marked up correctly.");
}

/** One entry per table in document order, holding that table's cell count per row. */
function tableShape(doc: Document): number[][] {
  return elementsByTag(doc, "w:tbl").map((tbl) =>
    childElements(tbl)
      .filter((c) => c.nodeName === "w:tr")
      .map((row) => childElements(row).filter((c) => c.nodeName === "w:tc").length)
  );
}

/**
 * Tables come out the shape they went in.
 *
 * Compared row by row rather than as totals. The splice bug Stage 0 found
 * merged two cells in one row and left the totals looking plausible.
 */
export function checkTableStructure(input: ReadPackage, output: ReadPackage): CheckResult {
  let tables = 0;

  for (const inPart of input.textParts) {
    const outPart = output.xmlParts.get(inPart.path);
    if (!outPart) continue; // parts_preserved reports this
    const before = tableShape(inPart.doc);
    const after = tableShape(outPart.doc);
    tables += before.length;

    if (before.length !== after.length) {
      return fail(
        "table_structure_preserved",
        `${inPart.path}: the document had ${before.length} table(s) and the marked-up copy has ${after.length}.`
      );
    }
    for (let t = 0; t < before.length; t++) {
      if (before[t].length !== after[t].length) {
        return fail(
          "table_structure_preserved",
          `${inPart.path}: table ${t + 1} had ${before[t].length} row(s) and now has ${after[t].length}.`
        );
      }
      for (let r = 0; r < before[t].length; r++) {
        if (before[t][r] !== after[t][r]) {
          return fail(
            "table_structure_preserved",
            `${inPart.path}: table ${t + 1}, row ${r + 1} had ${before[t][r]} cell(s) and now has ${after[t][r]} — cells were merged or lost.`
          );
        }
      }
    }
  }

  return pass("table_structure_preserved", `All ${tables} table(s) kept their rows and cells.`);
}
