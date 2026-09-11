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

const SCORING_DIR = path.join("lib", "eval");
const FORBIDDEN = [/corpus\//, /synthetic/i, /specs/, /data\/eval/, /sample-contracts/];

async function scoringFiles(): Promise<string[]> {
  const entries = await readdir(SCORING_DIR, { withFileTypes: true });
  return entries.filter((e) => e.isFile() && e.name.endsWith(".ts")).map((e) => path.join(SCORING_DIR, e.name));
}

describe("the scorer is key-agnostic", () => {
  it("has scoring modules at the top level of lib/eval", async () => {
    const files = await scoringFiles();
    expect(files.map((f) => path.basename(f)).sort()).toEqual(
      ["grade.ts", "hungarian.ts", "language.ts", "match.ts", "report.ts", "score.ts", "types.ts"].sort()
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
