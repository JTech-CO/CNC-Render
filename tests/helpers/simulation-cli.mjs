import { spawnSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("../..", import.meta.url));
const fixturePath = join(
  repositoryRoot,
  "tests",
  "fixtures",
  "machines",
  "vmc-3axis",
  "golden-poses.json",
);
const cargoRunner = join(repositoryRoot, "scripts", "run-cargo.mjs");
const cargoTargetRoot = resolve(
  repositoryRoot,
  process.env.CARGO_TARGET_DIR ?? "target",
);
const cargoProfileDirectory =
  process.env.CARGO_BUILD_TARGET === undefined
    ? join(cargoTargetRoot, "debug")
    : join(cargoTargetRoot, process.env.CARGO_BUILD_TARGET, "debug");
const simulationCliExecutable = join(
  cargoProfileDirectory,
  `simulation-cli${process.platform === "win32" ? ".exe" : ""}`,
);

let simulationCliBuilt = false;

function ensureSimulationCli() {
  if (simulationCliBuilt) {
    return;
  }

  const result = spawnSync(
    process.execPath,
    [
      cargoRunner,
      "build",
      "--quiet",
      "--locked",
      "-p",
      "cnc-render-simulation-core",
      "--bin",
      "simulation-cli",
    ],
    {
      cwd: repositoryRoot,
      encoding: "utf8",
      env: process.env,
      maxBuffer: 16 * 1024 * 1024,
      timeout: 180_000,
      windowsHide: true,
    },
  );

  if (result.error) {
    throw new Error(
      `simulation-cli could not be built: ${result.error.message}`,
    );
  }
  if (result.status !== 0) {
    throw new Error(
      [
        `simulation-cli build exited with status ${result.status}.`,
        result.stderr.trim(),
        result.stdout.trim(),
      ]
        .filter(Boolean)
        .join("\n"),
    );
  }
  if (!statSync(simulationCliExecutable).isFile()) {
    throw new Error(
      `simulation-cli build did not create ${simulationCliExecutable}.`,
    );
  }
  simulationCliBuilt = true;
}

export function loadGoldenPoseFixture() {
  return JSON.parse(readFileSync(fixturePath, "utf8"));
}

export function runSimulationCli(request) {
  ensureSimulationCli();
  const result = spawnSync(simulationCliExecutable, [], {
    cwd: repositoryRoot,
    encoding: "utf8",
    env: process.env,
    input: `${JSON.stringify(request)}\n`,
    maxBuffer: 16 * 1024 * 1024,
    timeout: 120_000,
    windowsHide: true,
  });
  if (result.error || result.status !== 0) {
    throw new Error(
      result.error?.message ??
        `simulation-cli failed: ${result.stderr.trim()}`,
    );
  }
  return JSON.parse(result.stdout.trim());
}
