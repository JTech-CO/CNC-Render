import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@cnc-render/web/foundation": fileURLToPath(
        new URL("./apps/web/src/foundation.ts", import.meta.url),
      ),
      "@cnc-render/contracts": fileURLToPath(
        new URL("./packages/contracts/src/index.ts", import.meta.url),
      ),
      "@cnc-render/lesson-engine": fileURLToPath(
        new URL("./packages/lesson-engine/src/index.ts", import.meta.url),
      ),
      "@cnc-render/ui": fileURLToPath(
        new URL("./packages/ui/src/index.ts", import.meta.url),
      ),
      "@cnc-render/simulation": fileURLToPath(
        new URL("./packages/simulation/src/index.ts", import.meta.url),
      ),
      "@cnc-render/renderer": fileURLToPath(
        new URL("./packages/renderer/src/index.ts", import.meta.url),
      ),
      "@cnc-render/storage": fileURLToPath(
        new URL("./packages/storage/src/index.ts", import.meta.url),
      ),
    },
  },
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.ts"],
    passWithNoTests: false,
    testTimeout: 10_000,
  },
});
