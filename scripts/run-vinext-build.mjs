import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const vinextEntryPath = fileURLToPath(import.meta.resolve("vinext"));
const vinextCliPath = join(dirname(vinextEntryPath), "cli.js");
const workspacePath = process.cwd();
const buildArguments = ["build", ...process.argv.slice(2)];
const needsShortWindowsPath =
  process.platform === "win32" &&
  (workspacePath.length >= 80 || /[^\x20-\x7e]/.test(workspacePath));

function runVinext(cwd, cliPath) {
  return spawnSync(process.execPath, [cliPath, ...buildArguments], {
    cwd,
    env: process.env,
    stdio: "inherit",
  });
}

if (!needsShortWindowsPath) {
  const result = runVinext(workspacePath, vinextCliPath);
  if (result.error) {
    throw result.error;
  }
  process.exitCode = result.status ?? 1;
} else {
  const availableDrive = [
    "R",
    "Q",
    "P",
    "N",
    "M",
    "L",
    "K",
    "J",
    "H",
    "G",
  ].find((letter) => !existsSync(`${letter}:\\`));

  if (!availableDrive) {
    throw new Error(
      "Vinext build needs a free drive letter for the Windows short-path workaround.",
    );
  }

  const drive = `${availableDrive}:`;
  const mappedWorkspace = `${drive}\\`;
  const mapping = spawnSync("subst", [drive, workspacePath], {
    stdio: "inherit",
  });

  if (mapping.error) {
    throw mapping.error;
  }
  if (mapping.status !== 0) {
    throw new Error(`Failed to map ${drive} to the CNC Render workspace.`);
  }

  console.info(
    `[build] Using temporary ${drive} mapping for the Windows native bundler.`,
  );

  let result;
  try {
    result = runVinext(
      mappedWorkspace,
      join(mappedWorkspace, "node_modules", "vinext", "dist", "cli.js"),
    );
  } finally {
    const cleanup = spawnSync("subst", [drive, "/D"], {
      stdio: "inherit",
    });
    if (cleanup.status !== 0) {
      console.error(`[build] Failed to remove temporary ${drive} mapping.`);
      process.exitCode = 1;
    }
  }

  if (result?.error) {
    throw result.error;
  }
  if (process.exitCode !== 1) {
    process.exitCode = result?.status ?? 1;
  }
}
