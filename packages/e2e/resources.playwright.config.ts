import { defineConfig } from "@playwright/test";
import benchmark from "./benchmark.playwright.config";
import { benchmarkProjects } from "../../scripts/benchmark-contract.mjs";

export default defineConfig({
  ...benchmark,
  testMatch: "reference-resources.spec.ts",
  timeout: 180_000,
  reporter: [["line"]],
  outputDir: "../../test-results/resources",
  projects: benchmarkProjects("reference").map((project) => ({
    name: project.name,
    metadata: project,
    use: { browserName: "chromium" as const, channel: project.browser, headless: true },
  })),
});
