import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve, sep } from "node:path";
import { benchmarkProjects } from "./benchmark-contract.mjs";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const benchmarkFiles = new Map([
  ["renderer-smoke", "tests/bench/renderer-smoke.test.ts"],
  ["collision-fixtures", "tests/bench/collision-fixtures.test.ts"],
  ["milling-golden", "tests/bench/milling-golden.test.ts"],
  ["coordinator", "tests/bench/coordinator.test.ts"],
  ["ui-budget", "tests/bench/ui-budget.test.ts"],
]);

const inputArguments = process.argv.slice(2);
const passthroughArguments = [];
let filter;
let report;
let matrix = "software";

for (let index = 0; index < inputArguments.length; index += 1) {
  const argument = inputArguments[index];
  if (argument === "--") continue;
  if (argument.startsWith("--report=")) {
    if (report !== undefined) throw new Error("--report may be specified only once.");
    report = argument.slice("--report=".length);
    continue;
  }
  if (argument.startsWith("--matrix=")) {
    matrix = argument.slice("--matrix=".length);
    continue;
  }
  if (argument === "--filter") {
    filter = inputArguments[index + 1];
    index += 1;
    continue;
  }
  if (argument.startsWith("--filter=")) {
    filter = argument.slice("--filter=".length);
    continue;
  }
  passthroughArguments.push(argument);
}

if (filter !== undefined && !benchmarkFiles.has(filter)) {
  console.error(`[bench] Unknown filter "${filter}".`);
  process.exit(2);
}

benchmarkProjects(matrix);
if (report !== undefined) {
  const artifacts = resolve("artifacts");
  report = resolve(report);
  if (!report.startsWith(artifacts + sep) || !report.endsWith(".json")) {
    throw new Error("Benchmark JSON reports must be inside the workspace artifacts directory.");
  }
  if (filter !== undefined || passthroughArguments.length > 0) {
    throw new Error("A matrix report requires the complete unfiltered benchmark suite.");
  }
} else if (matrix !== "software") {
  throw new Error("--matrix requires --report=artifacts/<name>.json.");
}
if (report !== undefined) {
  mkdirSync(dirname(report), { recursive: true });
  writeFileSync(report, JSON.stringify({ reportVersion: 1, functionalStatus: "incomplete", releaseStatus: "incomplete", stage: "cpu-smoke", matrix, executions: [] }, null, 2) + "\n");
}

const vitestCli = fileURLToPath(
  new URL("../node_modules/vitest/vitest.mjs", import.meta.url),
);
const result = spawnSync(
  process.execPath,
  [
    vitestCli,
    "run",
    "--config",
    "vitest.renderer-bench.config.ts",
    ...(filter === undefined ? [] : [benchmarkFiles.get(filter)]),
    ...passthroughArguments,
  ],
  {
    cwd: process.cwd(),
    env: process.env,
    stdio: "inherit",
  },
);

if (result.error) {
  console.error(`[bench] ${result.error.message}`);
  process.exit(1);
}

if (result.status !== 0 || report === undefined) process.exit(result.status ?? 1);
const browserResult = spawnSync(process.execPath, [
  fileURLToPath(new URL("../packages/e2e/node_modules/@playwright/test/cli.js", import.meta.url)),
  "test", "--config", "packages/e2e/benchmark.playwright.config.ts",
], {
  cwd: process.cwd(),
  env: { ...process.env, CNC_RENDER_BENCH_REPORT: report, CNC_RENDER_BENCH_MATRIX: matrix },
  stdio: "inherit",
});
if (browserResult.error) throw browserResult.error;
process.exit(browserResult.status ?? 1);
