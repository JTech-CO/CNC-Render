import { execFileSync } from "node:child_process";
import { relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";

const root = resolve(fileURLToPath(new URL("../../", import.meta.url)));
afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });

function expectIgnoredHtmlReport(reporter: unknown, suite: string) {
  const entries = reporter as Array<[string, { outputFolder?: string }]>;
  const output = entries.find(([name]) => name === "html")?.[1]?.outputFolder;
  expect(output).toBe(resolve(root, "playwright-report", suite));
  const relativeFile = relative(root, resolve(output!, "index.html")).replaceAll("\\", "/");
  expect(execFileSync("git", ["check-ignore", "--stdin"], {
    cwd: root, input: `${relativeFile}\n`, encoding: "utf8",
  }).trim()).toBe(relativeFile);
}

describe("CI browser artifacts do not dirty release sources", () => {
  it("routes the Pages HTML report to the ignored workspace root", async () => {
    vi.stubEnv("CI", "true");
    const { default: config } = await import("../../packages/e2e/pages.playwright.config");
    expectIgnoredHtmlReport(config.reporter, "pages");
  });
  it.each(["e2e", "visual", "a11y"])("keeps %s reports in their ignored suite folder", async (suite) => {
    vi.stubEnv("CI", "true");
    vi.stubEnv("CNC_RENDER_E2E_SUITE", suite);
    const { default: config } = await import("../../packages/e2e/playwright.config");
    expectIgnoredHtmlReport(config.reporter, suite);
  });
});
