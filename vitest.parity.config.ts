import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@cnc-render/contracts": fileURLToPath(
        new URL("./packages/contracts/src/index.ts", import.meta.url),
      ),
      "@cnc-render/simulation": fileURLToPath(
        new URL("./packages/simulation/src/index.ts", import.meta.url),
      ),
    },
  },
  test: {
    environment: "node",
    include: ["tests/parity/**/*.test.ts"],
    passWithNoTests: false,
    testTimeout: 10_000,
  },
});
