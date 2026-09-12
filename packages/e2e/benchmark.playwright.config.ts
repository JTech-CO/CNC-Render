import { defineConfig } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { benchmarkProjects, BENCHMARK_VIEWPORT } from "../../scripts/benchmark-contract.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
export default defineConfig({
  testDir: "./tests",
  testMatch: "reference-benchmark.spec.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 90_000,
  forbidOnly: true,
  reporter: [["line"], ["./benchmark-reporter.mjs"]],
  outputDir: `${root}/test-results/benchmark`,
  use: {
    baseURL: "http://127.0.0.1:43175/CNC-Render/",
    viewport: BENCHMARK_VIEWPORT,
    deviceScaleFactor: 1,
    colorScheme: "light",
    locale: "ko-KR",
    serviceWorkers: "block",
    trace: "off",
    screenshot: "off",
    video: "off",
  },
  webServer: {
    command: "node packages/e2e/start-pages-test-server.mjs",
    cwd: root,
    url: "http://127.0.0.1:43175/CNC-Render/",
    reuseExistingServer: false,
    timeout: 120_000,
  },
  projects: benchmarkProjects(process.env.CNC_RENDER_BENCH_MATRIX ?? "software").map((project) => ({
    name: project.name,
    metadata: project,
    use: {
      browserName: "chromium" as const,
      ...(project.browser === "chromium" ? {} : { channel: project.browser }),
      headless: true,
      launchOptions: {
        args: project.softwareRequested ? [
          "--use-angle=swiftshader", "--enable-unsafe-swiftshader",
          ...(project.backend === "webgpu" ? ["--enable-unsafe-webgpu", "--enable-features=Vulkan"] : []),
        ] : [],
      },
    },
  })),
});
