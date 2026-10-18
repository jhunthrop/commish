// The oracle's own test runner: the repository root's vitest config belongs to the retired league
// platform and loads plugins the oracle does not have, so vitest run from this directory stops here.
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@research-ts": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
