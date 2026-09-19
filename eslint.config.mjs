import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([
    ".next/**",
    ".vinext/**",
    ".wrangler/**",
    "coverage/**",
    ".cache/**",
    "artifacts/**",
    "playwright-report/**",
    "test-results/**",
    "dist/**",
    "node_modules/**",
    "out/**",
    "storybook-static/**",
    "target/**",
    "next-env.d.ts",
    "crates/**/pkg/**",
  ]),
]);
