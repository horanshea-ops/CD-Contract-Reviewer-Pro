import type { ExportOutcome } from "../redline-validation";

/** A JSON body a route returns as-is. */
export type JsonBody = Record<string, unknown>;

/**
 * What an export builder produces.
 *
 * Side effects live in `commit` rather than running during the build, because
 * `?preflight=1` needs the verdict without the `exports` row or the audit entry.
 * One build path then serves both the preflight check and the real download.
 */
export type ExportBuildResult = ExportFileResult | ExportRefusalResult;

export interface ExportFileResult {
  kind: "file";
  filename: string;
  contentType: string;
  bytes: Uint8Array;
  outcome: ExportOutcome;

  /** The verdict `?preflight=1` returns, or null where the format has no preflight. */
  preflight: JsonBody | null;

  extraHeaders?: Record<string, string>;

  /** Writes the `exports` row and the audit entry. Called only when the file is delivered. */
  commit: () => Promise<void>;
}

export interface ExportRefusalResult {
  kind: "refusal";
  status: number;

  /** The error JSON the single-file route returns. */
  body: JsonBody;

  preflight: JsonBody | null;

  /** One line naming the format and why it produced nothing, for the zip manifest. */
  summary: string;

  /** Some refusals are still worth recording — a redline rejected by the oracle is one. */
  commit?: () => Promise<void>;
}

export type ExportFormatKey = "memo" | "markup" | "redline" | "clean";

export const EXPORT_FORMAT_KEYS: ExportFormatKey[] = ["memo", "markup", "redline", "clean"];
