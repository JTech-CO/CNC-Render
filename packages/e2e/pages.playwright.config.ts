import { defineConfig, devices } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const packageDirectory = dirname(fileURLToPath(import.meta.url));
const workspaceDirectory = resolve(packageDirectory, "../..");
const baseURL = "http://127.0.0.1:43175/CNC-Render/";

export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  timeout: 45_000,
  expect: {
    timeout: 10_000,
  },
  reporter: process.env.CI
    ? [["github"], ["html", { open: "never" }]]
    : [["line"]],
  outputDir: resolve(workspaceDirectory, "test-results/pages"),
  use: {
    baseURL,
    colorScheme: "light",
    locale: "ko-KR",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    viewport: { width: 2_048, height: 1_009 },
  },
  webServer: {
    command: "node packages/e2e/start-pages-test-server.mjs",
    cwd: workspaceDirectory,
    url: baseURL,
    reuseExistingServer: false,
    timeout: 120_000,
  },
  projects: [
    {
      name: "github-pages-chromium",
      use: {
        ...devices["Desktop Chrome"],
        launchOptions: {
          args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
        },
        viewport: { width: 2_048, height: 1_009 },
      },
    },
  ],
});
