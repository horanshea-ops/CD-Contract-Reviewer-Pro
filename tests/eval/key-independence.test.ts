import { describe, it, expect } from "vitest";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

/**
 * The scorer must not know which answer key it is scoring against.
 *
 * §2.0.1's whole point is that CD's real key arrives as a data swap rather than
 * a build. That is only true if nothing in the scoring path reaches for the
 * synthetic key, the synthetic specs, or the corpus that generated them — and
 * "we were careful" is not a guarantee, so it is asserted.
 *
 * lib/eval/corpus/ is exempt. That directory BUILDS the synthetic corpus and is
 * expected to import its specs; it is not on the path that reads a run and
 * produces a report.
 */

/** The findings scorer, and the term extraction scorer beside it (§2.0.2). */
const SCORING_DIRS = [path.join("lib", "eval"), path.join("lib", "eval", "terms")];
const FORBIDDEN = [/corpus\//, /synthetic/i, /specs/, /data\/eval/, /sample-contracts/];

async function scoringFiles(): Promise<string[]> {
  const files: string[] = [];
  for (const dir of SCORING_DIRS) {
    const entries = await readdir(dir, { withFileTypes: true });
    files.push(...entries.filter((e) => e.isFile() && e.name.endsWith(".ts")).map((e) => path.join(dir, e.name)));
  }
  return files;
}

describe("the scorer is key-agnostic", () => {
  it("has the scoring modules it is expected to have", async () => {
    const files = await scoringFiles();
    expect(files.map((f) => path.relative(path.join("lib", "eval"), f)).sort()).toEqual(
      [
        "grade.ts",
        "hungarian.ts",
        "language.ts",
        "match.ts",
        "report.ts",
        "score.ts",
        "types.ts",
        path.join("terms", "report.ts"),
        path.join("terms", "score.ts"),
        path.join("terms", "types.ts"),
      ].sort()
    );
  });

  it("never imports the synthetic key, its specs, or the corpus that built them", async () => {
    for (const file of await scoringFiles()) {
      const source = await readFile(file, "utf8");
      const imports = [...source.matchAll(/^\s*import[\s\S]*?from\s+"([^"]+)"/gm)].map((m) => m[1]);

      for (const specifier of imports) {
        for (const banned of FORBIDDEN) {
          expect(banned.test(specifier), `${file} imports ${specifier}`).toBe(false);
        }
      }
    }
  });

  it("reads no file paths of its own, so the key can only arrive as an argument", async () => {
    // A scorer that opened a path would have a default key, and a default key
    // is the thing that stops being swappable.
    for (const file of await scoringFiles()) {
      const source = await readFile(file, "utf8");
      expect(source, `${file} reads from disk`).not.toMatch(/readFile|readFileSync|require\(/);
    }
  });
});
