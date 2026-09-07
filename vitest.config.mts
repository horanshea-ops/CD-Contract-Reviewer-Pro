import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    // Mirrors tsconfig.json's "paths", so tests import modules the same way
    // application code does ("@/lib/..." rather than brittle relative paths).
    alias: { "@": fileURLToPath(new URL("./", import.meta.url)) },
  },
  test: {
    // Node, not jsdom: everything under test here is server-side document and
    // XML handling. Add a browser environment only when a component needs one.
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // Extraction and revision fixtures are large; the default 5s is too tight
    // for the 100-iteration determinism check in §1.4.8.
    testTimeout: 30_000,
  },
});
