import { describe, expect, it } from "vitest";
import { acceptOwnRevisions } from "@/lib/docx-accept";
import { checkCleanCopy } from "@/lib/exports/clean-docx";
import { generateRedline } from "@/lib/redline-engine";
import { readPackage, validateRedline } from "@/lib/redline-validation";
import { allRevisions, elementsByTag, type ReadPackage } from "@/lib/redline-validation/package";
import { FIXTURE_AUTHOR, FIXTURE_CORPUS, readFixture } from "./helpers/fixture-corpus";

/**
 * Our changes on a file the property has already marked up.
 *
 * Fixture 16 copies the shapes of a real Pages export. A redline built on that
 * export opened in Word without a repair prompt (2026-10-03), so these tests
 * pin the markup it carried.
 */

const FILE = "16-pages-export-comments.docx";
const PROPERTY = "Dana Reyes";
const NOTE = "Keeps the group's costs in line with the rooms it uses.";

async function read(bytes: Uint8Array): Promise<ReadPackage> {
  const r = await readPackage(bytes);
  if (!r.ok) throw new Error(r.error);
  return r.pkg;
}

async function build() {
  const { findings } = FIXTURE_CORPUS.find((c) => c.file === FILE)!;
  const originalBytes = new Uint8Array(await readFixture(FILE));
  const result = await generateRedline({
    originalDocxBytes: originalBytes,
    findings,
    comments: new Map(findings.map((f) => [f.id, NOTE])),
    author: FIXTURE_AUTHOR,
  });
  const report = await validateRedline({ originalBytes, engineResult: result, author: FIXTURE_AUTHOR });
  const own = new Set(result.ownRevisionIds);
  const ownComments = { ids: new Set(result.ownCommentIds), createdPart: result.createdCommentsPart };
  const clean = await acceptOwnRevisions(result.docxBytes, own, ownComments);
  return { result, report, own, ownComments, clean };
}

const hasAncestor = (el: Element, tag: string, author: string) => {
  for (let node = el.parentNode as Element | null; node && node.nodeType === 1; node = node.parentNode as Element | null) {
    if (node.nodeName === tag && node.getAttribute("w:author") === author) return true;
  }
  return false;
};

const commentAuthors = (pkg: ReadPackage) =>
  elementsByTag(pkg.xmlParts.get("word/comments.xml")!.doc, "w:comment").map((c) => c.getAttribute("w:author"));

describe("a redline on a file the property marked up", () => {
  it("applies both changes and passes every oracle check", async () => {
    const { report } = await build();
    expect(report.checks.filter((c) => !c.passed)).toEqual([]);
    expect(report.appliedCount).toBe(2);
    expect(report.outcome).toBe("clean");
  });

  it("strikes the property's inserted and struck words inside their own revisions", async () => {
    const { result } = await build();
    const ours = allRevisions(await read(result.docxBytes)).filter((r) => r.author === FIXTURE_AUTHOR && r.tag === "w:del");

    expect(ours.some((r) => hasAncestor(r.el, "w:ins", PROPERTY))).toBe(true);
    expect(ours.some((r) => hasAncestor(r.el, "w:del", PROPERTY))).toBe(true);
  });

  it("leaves every marker of the property's comments outside our changes", async () => {
    const { result, own } = await build();
    const doc = (await read(result.docxBytes)).xmlParts.get("word/document.xml")!.doc;

    for (const tag of ["w:commentRangeStart", "w:commentRangeEnd", "w:commentReference"]) {
      const theirs = elementsByTag(doc, tag).filter((el) => ["21", "24", "26"].includes(el.getAttribute("w:id") ?? ""));
      expect(theirs).toHaveLength(3);
      for (const el of theirs) {
        for (let node = el.parentNode as Element | null; node && node.nodeType === 1; node = node.parentNode as Element | null) {
          expect(own.has(node.getAttribute("w:id") ?? ""), `${tag} ${el.getAttribute("w:id")} sits inside our change`).toBe(false);
        }
      }
    }
  });

  it("keeps the property's three comments beside ours", async () => {
    const { result } = await build();
    const authors = commentAuthors(await read(result.docxBytes));
    expect(authors.filter((a) => a === PROPERTY)).toHaveLength(3);
    expect(authors.filter((a) => a === FIXTURE_AUTHOR)).toHaveLength(2);
  });

  it("gives a clean copy that passes its check and holds only the property's comments", async () => {
    const { result, own, ownComments, clean } = await build();
    expect(await checkCleanCopy(result.docxBytes, clean, own, ownComments)).toEqual([]);
    expect(commentAuthors(await read(clean))).toEqual([PROPERTY, PROPERTY, PROPERTY]);
  });
});
