import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@cnc-render/renderer": fileURLToPath(
        new URL("./packages/renderer/src/index.ts", import.meta.url),
      ),
    },
  },
  test: {
    environment: "node",
    include: ["tests/bench/**/*.test.ts"],
    passWithNoTests: false,
    testTimeout: 10_000,
  },
});
