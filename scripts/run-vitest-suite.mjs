import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const suites = {
  unit: {
    config: "vitest.config.ts",
    directory: "tests/unit",
  },
  contracts: {
    config: "vitest.contracts.config.ts",
    directory: "tests/contracts",
  },
  parity: {
    config: "vitest.parity.config.ts",
    directory: "tests/parity",
  },
};

const suiteName = process.argv[2];
const suite = suites[suiteName];

if (!suite) {
  console.error(
    `[vitest-suite] Unknown suite "${suiteName ?? ""}". Expected unit, contracts, or parity.`,
  );
  process.exit(2);
}

const inputArguments = process.argv.slice(3);
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

if (filter !== undefined && filter.length === 0) {
  console.error("[vitest-suite] --filter requires a non-empty value.");
  process.exit(2);
}

function findTestFiles(directory) {
  const files = [];

  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const entryPath = join(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...findTestFiles(entryPath));
      continue;
    }

    if (/\.(?:test|spec)\.[cm]?[jt]sx?$/.test(entry.name)) {
      files.push(entryPath);
    }
  }

  return files;
}

const vitestCli = fileURLToPath(
  new URL("../node_modules/vitest/vitest.mjs", import.meta.url),
);
const vitestArguments = [vitestCli, "run", "--config", suite.config];

if (filter) {
  const normalizedFilter = filter.toLocaleLowerCase("en-US");
  const testFiles = findTestFiles(suite.directory);
  const matchingFiles = testFiles.filter((file) =>
    relative(process.cwd(), file)
      .toLocaleLowerCase("en-US")
      .includes(normalizedFilter),
  );

  if (matchingFiles.length > 0) {
    vitestArguments.push(...matchingFiles);
  } else {
    const matchingContent = testFiles.some((file) =>
      readFileSync(file, "utf8")
        .toLocaleLowerCase("en-US")
        .includes(normalizedFilter),
    );

    if (!matchingContent) {
      console.error(
        `[vitest-suite] Filter "${filter}" matched no ${suiteName} test file or test declaration.`,
      );
      process.exit(2);
    }

    vitestArguments.push("--testNamePattern", filter);
  }
}

vitestArguments.push(...passthroughArguments);

const result = spawnSync(process.execPath, vitestArguments, {
  cwd: process.cwd(),
  env: process.env,
  stdio: "inherit",
});

if (result.error) {
  console.error(`[vitest-suite] ${result.error.message}`);
  process.exit(1);
}

process.exit(result.status ?? 1);
