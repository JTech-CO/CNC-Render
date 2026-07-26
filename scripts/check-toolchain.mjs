import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";

const packageJson = JSON.parse(
  await readFile(new URL("../package.json", import.meta.url), "utf8"),
);
const expectedNode = packageJson.engines?.node;
const expectedPnpm = packageJson.engines?.pnpm;
const expectedPackageManager = `pnpm@${expectedPnpm}`;
const errors = [];

if (!/^\d+\.\d+\.\d+$/.test(expectedNode ?? "")) {
  errors.push("package.json engines.node must be an exact semantic version.");
}

if (!/^\d+\.\d+\.\d+$/.test(expectedPnpm ?? "")) {
  errors.push("package.json engines.pnpm must be an exact semantic version.");
}

if (packageJson.packageManager !== expectedPackageManager) {
  errors.push(
    `packageManager must be ${expectedPackageManager}; found ${JSON.stringify(packageJson.packageManager)}.`,
  );
}

if (process.versions.node !== expectedNode) {
  errors.push(
    `Node ${expectedNode} is required; running ${process.versions.node}.`,
  );
}

const userAgentPnpm = process.env.npm_config_user_agent?.match(
  /(?:^|\s)pnpm\/([^\s]+)/u,
)?.[1];
let actualPnpm = userAgentPnpm;

if (!actualPnpm) {
  const result =
    process.platform === "win32"
      ? spawnSync(
          process.env.ComSpec ?? "C:\\Windows\\System32\\cmd.exe",
          ["/d", "/s", "/c", "pnpm --version"],
          {
            encoding: "utf8",
            windowsHide: true,
          },
        )
      : spawnSync("pnpm", ["--version"], {
          encoding: "utf8",
        });

  if (result.error) {
    errors.push(`Unable to execute pnpm: ${result.error.message}`);
  } else if (result.status !== 0) {
    errors.push(`pnpm --version exited with code ${result.status}.`);
  } else {
    actualPnpm = result.stdout.trim();
  }
}

if (actualPnpm && actualPnpm !== expectedPnpm) {
  errors.push(`pnpm ${expectedPnpm} is required; running ${actualPnpm}.`);
}

if (errors.length > 0) {
  console.error("[toolchain] Version contract failed:");
  for (const error of errors) {
    console.error(`  - ${error}`);
  }
  process.exitCode = 1;
} else {
  console.log(
    `[toolchain] Node ${expectedNode} and pnpm ${expectedPnpm} match package.json.`,
  );
}
