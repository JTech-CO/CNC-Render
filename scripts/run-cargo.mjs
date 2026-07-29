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

function existingFile(candidate) {
  try {
    return statSync(candidate).isFile() ? candidate : null;
  } catch {
    return null;
  }
}

function windowsVsDevCmd() {
  if (process.platform !== "win32") {
    return null;
  }

  const candidates = [];
  if (process.env.VSINSTALLDIR) {
    candidates.push(
      resolve(process.env.VSINSTALLDIR, "Common7", "Tools", "VsDevCmd.bat"),
    );
  }

  const programFilesX86 = process.env["ProgramFiles(x86)"];
  if (programFilesX86) {
    for (const edition of [
      "BuildTools",
      "Community",
      "Professional",
      "Enterprise",
    ]) {
      candidates.push(
        resolve(
          programFilesX86,
          "Microsoft Visual Studio",
          "2022",
          edition,
          "Common7",
          "Tools",
          "VsDevCmd.bat",
        ),
      );
    }
  }

  return candidates.map(existingFile).find(Boolean) ?? null;
}

function windowsMsvcEnvironment() {
  const vsDevCmd = windowsVsDevCmd();
  if (!vsDevCmd) {
    return process.env;
  }

  const commandInterpreter =
    process.env.ComSpec ?? "C:\\Windows\\System32\\cmd.exe";
  const result = spawnSync(
    commandInterpreter,
    [
      "/d",
      "/s",
      "/c",
      `call "${vsDevCmd}" -no_logo -arch=x64 -host_arch=x64 >nul && set`,
    ],
    {
      encoding: "utf8",
      windowsHide: true,
      windowsVerbatimArguments: true,
    },
  );

  if (result.error || result.status !== 0) {
    const reason = result.error?.message ?? `exit code ${result.status}`;
    console.error(`[cargo] Unable to initialize the MSVC environment: ${reason}`);
    return null;
  }

  const environment = { ...process.env };
  for (const line of result.stdout.split(/\r?\n/u)) {
    const separator = line.indexOf("=");
    if (separator <= 0) {
      continue;
    }
    environment[line.slice(0, separator)] = line.slice(separator + 1);
  }
  return environment;
}

const cargoExecutable = pathCargoIsAvailable() ?? windowsRustupCargo();

if (!cargoExecutable) {
  console.error(
    "[cargo] cargo was not found on PATH or in USERPROFILE/.cargo/bin/cargo.exe.",
  );
  process.exitCode = 127;
} else {
  const cargoEnvironment =
    process.platform === "win32" ? windowsMsvcEnvironment() : process.env;

  if (!cargoEnvironment) {
    process.exitCode = 1;
  } else {
    const result = spawnSync(cargoExecutable, process.argv.slice(2), {
      env: cargoEnvironment,
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
}
