import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const inputArguments = process.argv.slice(2);
const passthroughArguments = [];
let filter;

for (let index = 0; index < inputArguments.length; index += 1) {
  const argument = inputArguments[index];
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

if (filter !== undefined && filter !== "renderer-smoke") {
  console.error(`[renderer-bench] Unknown filter "${filter}".`);
  process.exit(2);
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
    ...passthroughArguments,
  ],
  {
    cwd: process.cwd(),
    env: process.env,
    stdio: "inherit",
  },
);

if (result.error) {
  console.error(`[renderer-bench] ${result.error.message}`);
  process.exit(1);
}

process.exit(result.status ?? 1);
