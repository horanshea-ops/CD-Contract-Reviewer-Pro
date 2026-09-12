import { buildMemo } from "./memo";
import { buildMarkup } from "./markup";
import { buildRedline } from "./redline";
import { buildCleanContract } from "./clean-contract";
import type { ExportContext } from "./context";
import type { ExportBuildResult, ExportFormatKey } from "./types";

/** Every export format, keyed the way the picker and the zip route name them. */
export const EXPORT_BUILDERS: Record<
  ExportFormatKey,
  (ctx: ExportContext) => Promise<ExportBuildResult>
> = {
  memo: buildMemo,
  markup: buildMarkup,
  redline: buildRedline,
  clean: buildCleanContract,
};
