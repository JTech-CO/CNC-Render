import { defineConfig, devices } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const packageDirectory = dirname(fileURLToPath(import.meta.url));
const workspaceDirectory = resolve(packageDirectory, "../..");
const baseURL = "http://127.0.0.1:43173";
const softwareRenderingArguments = [
  "--use-angle=swiftshader",
  "--enable-unsafe-swiftshader",
];

export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  timeout: 30_000,
  expect: {
    timeout: 10_000,
    toHaveScreenshot: {
      animations: "disabled",
      caret: "hide",
      maxDiffPixelRatio: 0.01,
    },
  },
  reporter: process.env.CI
    ? [["github"], ["html", { open: "never" }]]
    : [["line"]],
  outputDir: resolve(workspaceDirectory, "test-results"),
  snapshotPathTemplate: "{testDir}/__screenshots__/{arg}{ext}",
  use: {
    baseURL,
    colorScheme: "light",
    locale: "ko-KR",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    viewport: { width: 1_440, height: 900 },
  },
  webServer: {
    command: "node packages/e2e/start-test-server.mjs",
    cwd: workspaceDirectory,
    url: baseURL,
    reuseExistingServer: false,
    timeout: 120_000,
  },
  projects: [
    {
      name: "chromium-webgpu",
      use: {
        ...devices["Desktop Chrome"],
        launchOptions: {
          args: [
            ...softwareRenderingArguments,
            "--enable-unsafe-webgpu",
            "--enable-features=Vulkan",
          ],
        },
        viewport: { width: 1_440, height: 900 },
      },
    },
    {
      name: "chromium-webgl2",
      use: {
        ...devices["Desktop Chrome"],
        launchOptions: {
          args: softwareRenderingArguments,
        },
        viewport: { width: 1_440, height: 900 },
      },
    },
    {
      name: "visual",
      use: {
        ...devices["Desktop Chrome"],
        launchOptions: {
          args: softwareRenderingArguments,
        },
        viewport: { width: 1_440, height: 900 },
      },
    },
  ],
});
