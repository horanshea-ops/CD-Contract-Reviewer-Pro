import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // eslint-config-next bundles jsx-a11y but only enables rules that catch
      // misuse of aria/alt attributes already present — not this one, which
      // is the actual gap this codebase had (labels not wired to controls).
      "jsx-a11y/label-has-associated-control": "warn",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Generated (see scripts/copy-pdf-worker.mjs) — vendored pdfjs-dist code, not project source.
    "public/pdf.worker.min.mjs",
  ]),
]);

export default eslintConfig;
