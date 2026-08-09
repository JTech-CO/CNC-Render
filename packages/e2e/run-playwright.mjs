import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const suiteName = process.argv[2];
const suiteFiles = {
  e2e: [
    "tests/collision-stop.spec.ts",
    "tests/material-removal-milling.spec.ts",
    "tests/viewport.spec.ts",
    "tests/viewport-soak.spec.ts",
  ],
  visual: ["tests/machine-scene.visual.spec.ts"],
};
const selectedSuiteFiles = suiteFiles[suiteName];

if (!selectedSuiteFiles) {
  console.error(
    `[playwright-suite] Unknown suite "${suiteName ?? ""}". Expected e2e or visual.`,
  );
  process.exit(2);
}

const playwrightCli = fileURLToPath(
  new URL("./node_modules/@playwright/test/cli.js", import.meta.url),
);
const configPath = fileURLToPath(
  new URL("./playwright.config.ts", import.meta.url),
);
const result = spawnSync(
  process.execPath,
  [
    playwrightCli,
    "test",
    "--config",
    configPath,
    ...selectedSuiteFiles,
    ...process.argv.slice(3),
  ],
  {
    cwd: fileURLToPath(new URL(".", import.meta.url)),
    env: process.env,
    stdio: "inherit",
  },
);

if (result.error) {
  console.error(`[playwright-suite] ${result.error.message}`);
  process.exit(1);
}

process.exit(result.status ?? 1);
