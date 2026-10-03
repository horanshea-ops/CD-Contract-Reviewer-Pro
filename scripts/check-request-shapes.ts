import { loadEnvLocal } from "./load-env";
loadEnvLocal();

import { readdir, readFile } from "fs/promises";
import path from "path";
import { countRequestTokens } from "../lib/anthropic";

/**
 * Checks every pinned model request against the API without paying for one.
 *
 * The token-counting endpoint bills nothing and rejects a request the model
 * wouldn't accept: a forced tool on Sonnet 5.5, a thinking setting it refuses,
 * or an output format whose schema won't compile. The requests are the goldens
 * in tests/fixtures/prompt-golden, which are byte for byte what the app sends.
 *
 * Run it after any change to how a request is built:
 *   npx tsx scripts/check-request-shapes.ts
 */

const GOLDENS = path.join("tests", "fixtures", "prompt-golden");
const ANALYSIS_NEW = "analysis-request-sonnet-5-5.json";
const ANALYSIS_OLD = "analysis-request.json";

type Request = Record<string, unknown>;

/** A golden as the counting endpoint takes it, without the fields only a real call has. */
async function load(file: string): Promise<Request> {
  const { max_tokens, stream, ...params } = JSON.parse(await readFile(path.join(GOLDENS, file), "utf-8"));
  void max_tokens;
  void stream;
  return params;
}

async function count(params: Request): Promise<{ tokens: number } | { error: string }> {
  try {
    return { tokens: await countRequestTokens(params as never) };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

/** A schema with every description removed. */
function withoutDescriptions<T>(schema: T): T {
  if (Array.isArray(schema)) return schema.map(withoutDescriptions) as T;
  if (schema === null || typeof schema !== "object") return schema;
  const node: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(schema)) {
    if (key === "description" && typeof value === "string") continue;
    node[key] = key === "enum" || key === "required" ? value : withoutDescriptions(value);
  }
  return node as T;
}

let failures = 0;

function report(ok: boolean, label: string, detail: string) {
  if (!ok) failures++;
  console.log(`${ok ? "ok  " : "FAIL"}  ${label}  ${detail}`);
}

async function main() {
  const files = (await readdir(GOLDENS)).filter((f) => f.includes("-request") && f.endsWith(".json")).sort();

  console.log("Every pinned request must be accepted:");
  for (const file of files) {
    const result = await count(await load(file));
    report("tokens" in result, file, "tokens" in result ? `${result.tokens} tokens` : result.error);
  }

  console.log("\nA request Sonnet 5.5 refuses must be rejected, which shows the endpoint is checking:");

  const forced = await count({ ...(await load(ANALYSIS_OLD)), model: "claude-sonnet-5-5" });
  report("error" in forced, "a forced tool on Sonnet 5.5", "error" in forced ? forced.error : "accepted");

  const base = await load(ANALYSIS_NEW);
  const format = (base.output_config as { format: { schema: unknown } }).format;
  const tooHigh = await count({ ...base, output_config: { effort: "xhigh", format } });
  report("error" in tooHigh, "between_tools at effort xhigh", "error" in tooHigh ? tooHigh.error : "accepted");

  console.log("\nThe model must see the instructions written inside the schema:");

  const full = await count(base);
  const bare = await count({
    ...base,
    output_config: { effort: "high", format: { ...format, schema: withoutDescriptions(format.schema) } },
  });
  if ("tokens" in full && "tokens" in bare) {
    report(bare.tokens < full.tokens, "descriptions count toward the request", `${full.tokens} tokens with them, ${bare.tokens} without`);
  } else {
    report(false, "descriptions count toward the request", "error" in full ? full.error : (bare as { error: string }).error);
  }

  console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
