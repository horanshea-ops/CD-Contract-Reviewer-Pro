import { loadEnvLocal } from "./load-env";
loadEnvLocal();

import { loadStandardsLibrary, hashStandards } from "../lib/standards/load";
import { STANDARDS_LIBRARY } from "../lib/standards/v1";

/**
 * Reports which standards library the analysis pipeline would actually use.
 *
 * Worth having because the database is the source of truth while
 * lib/standards/v1.ts remains the seed and the fallback — so the two can drift.
 * "The database has diverged" is the expected state once an admin edits an
 * entry; "bundled_fallback" during normal operation means the model is not
 * seeing those edits and wants investigating.
 */

async function main() {
  const loaded = await loadStandardsLibrary();
  console.log("source        :", loaded.source);
  console.log("entries       :", loaded.entries.length);
  console.log("version       :", loaded.version);
  console.log("hash          :", loaded.hash.slice(0, 16));
  if (loaded.fallbackReason) console.log("fallbackReason:", loaded.fallbackReason);

  console.log("bundled hash  :", hashStandards(STANDARDS_LIBRARY).slice(0, 16));
  console.log(
    "db matches bundled:",
    loaded.hash === hashStandards(STANDARDS_LIBRARY)
      ? "yes (seeded, unedited)"
      : "NO — the database has diverged from lib/standards/v1.ts"
  );

  const provenance = loaded.entries.reduce<Record<string, number>>((acc, e) => {
    acc[e.provenance] = (acc[e.provenance] ?? 0) + 1;
    return acc;
  }, {});
  console.log("provenance    :", provenance);
}
main().catch((e) => { console.error(e); process.exit(1); });
