import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const workspacePath = fileURLToPath(new URL("..", import.meta.url));
const sourcePath = join(
  workspacePath,
  "target",
  "wasm32-unknown-unknown",
  "release",
  "cnc_render_wasm.wasm",
);
const outputPath = join(
  workspacePath,
  "public",
  "wasm",
  "cnc_render_wasm.wasm",
);

const result = spawnSync(
  "cargo",
  [
    "build",
    "--release",
    "--target",
    "wasm32-unknown-unknown",
    "--package",
    "cnc-render-wasm",
    "--locked",
  ],
  {
    cwd: workspacePath,
    env: process.env,
    stdio: "inherit",
  },
);

if (result.error) {
  throw result.error;
}
if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

mkdirSync(dirname(outputPath), { recursive: true });
copyFileSync(sourcePath, outputPath);

const bytes = readFileSync(outputPath);
const checksum = createHash("sha256").update(bytes).digest("hex");
const byteLength = statSync(outputPath).size;
console.info(`[wasm] cnc-render-wasm ${byteLength} bytes sha256 ${checksum}`);
