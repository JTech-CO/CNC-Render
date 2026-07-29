import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const usage =
  "Usage: pnpm fuzz:gcode -- --time=SECONDS [--seed=UNSIGNED_INTEGER]";

let timeSeconds;
let seed;

const rawArguments = process.argv.slice(2);
const cliArguments =
  rawArguments[0] === "--" ? rawArguments.slice(1) : rawArguments;

for (const argument of cliArguments) {
  const timeMatch = /^--time=([1-9]\d*)$/u.exec(argument);
  if (timeMatch) {
    if (timeSeconds !== undefined) {
      console.error("[fuzz:gcode] --time may be specified only once.");
      console.error(usage);
      process.exit(2);
    }
    timeSeconds = Number(timeMatch[1]);
    continue;
  }

  const seedMatch = /^--seed=(0|[1-9]\d*)$/u.exec(argument);
  if (seedMatch) {
    if (seed !== undefined) {
      console.error("[fuzz:gcode] --seed may be specified only once.");
      console.error(usage);
      process.exit(2);
    }
    seed = seedMatch[1];
    continue;
  }

  console.error(`[fuzz:gcode] Unsupported argument "${argument}".`);
  console.error(usage);
  process.exit(2);
}

if (
  timeSeconds === undefined ||
  !Number.isSafeInteger(timeSeconds) ||
  timeSeconds > 86_400
) {
  console.error(
    "[fuzz:gcode] --time must be a positive integer no greater than 86400.",
  );
  console.error(usage);
  process.exit(2);
}

const cargoRunner = fileURLToPath(new URL("./run-cargo.mjs", import.meta.url));
const fuzzArguments = [`--time=${timeSeconds}`];
if (seed !== undefined) {
  fuzzArguments.push(`--seed=${seed}`);
}

const result = spawnSync(
  process.execPath,
  [
    cargoRunner,
    "run",
    "--quiet",
    "--locked",
    "-p",
    "cnc-render-gcode-core",
    "--bin",
    "gcode-fuzz",
    "--",
    ...fuzzArguments,
  ],
  {
    cwd: fileURLToPath(new URL("..", import.meta.url)),
    env: process.env,
    stdio: "inherit",
    timeout: (timeSeconds + 30) * 1_000,
    windowsHide: true,
  },
);

if (result.error) {
  if (result.error.code === "ETIMEDOUT") {
    console.error(
      `[fuzz:gcode] gcode-fuzz exceeded the ${timeSeconds + 30}s hard timeout.`,
    );
    process.exit(1);
  }

  console.error(`[fuzz:gcode] Failed to launch gcode-fuzz: ${result.error.message}`);
  process.exit(1);
}

process.exit(result.status ?? 1);
