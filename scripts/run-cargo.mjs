import { spawnSync } from "node:child_process";
import { statSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";

function pathCargoIsAvailable() {
  const probe = spawnSync("cargo", ["--version"], {
    stdio: "ignore",
    windowsHide: true,
  });

  return probe.error ? null : "cargo";
}

function windowsRustupCargo() {
  if (process.platform !== "win32") {
    return null;
  }

  const userProfile = process.env.USERPROFILE;
  if (!userProfile || !isAbsolute(userProfile)) {
    return null;
  }

  const candidate = resolve(userProfile, ".cargo", "bin", "cargo.exe");

  try {
    return statSync(candidate).isFile() ? candidate : null;
  } catch {
    return null;
  }
}

const cargoExecutable = pathCargoIsAvailable() ?? windowsRustupCargo();

if (!cargoExecutable) {
  console.error(
    "[cargo] cargo was not found on PATH or in USERPROFILE/.cargo/bin/cargo.exe.",
  );
  process.exitCode = 127;
} else {
  const result = spawnSync(cargoExecutable, process.argv.slice(2), {
    stdio: "inherit",
    windowsHide: true,
  });

  if (result.error) {
    console.error(`[cargo] Failed to launch cargo: ${result.error.message}`);
    process.exitCode = 1;
  } else if (typeof result.status === "number") {
    process.exitCode = result.status;
  } else {
    console.error(
      `[cargo] Cargo terminated without an exit code${result.signal ? ` (${result.signal})` : ""}.`,
    );
    process.exitCode = 1;
  }
}
