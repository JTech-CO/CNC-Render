import { spawnSync } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { gzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const distClient = resolve(repositoryRoot, "dist/client");

const build = spawnSync(
  process.execPath,
  [resolve(repositoryRoot, "scripts/run-vinext-build.mjs")],
  {
    cwd: repositoryRoot,
    env: process.env,
    stdio: "inherit",
  },
);
if (build.error) {
  throw build.error;
}
if (build.status !== 0) {
  process.exit(build.status ?? 1);
}

async function collect(directory, files = []) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      await collect(path, files);
    } else if (entry.isFile()) {
      files.push(path);
    }
  }
  return files;
}

const files = await collect(distClient);
const cssFiles = files.filter((path) => extname(path) === ".css");
const fontFiles = files.filter((path) => extname(path) === ".woff2");
const jsFiles = files.filter((path) => extname(path) === ".js");
const cssGzipBytes = gzipSync(
  Buffer.concat(await Promise.all(cssFiles.map((path) => readFile(path)))),
).byteLength;
const fontBytes = (
  await Promise.all(fontFiles.map(async (path) => (await readFile(path)).byteLength))
).reduce((total, size) => total + size, 0);
const jsGzipBytes = gzipSync(
  Buffer.concat(await Promise.all(jsFiles.map((path) => readFile(path)))),
).byteLength;

const limits = {
  cssGzipBytes: 80 * 1024,
  fontBytes: 400 * 1024,
};

console.log(
  `[ui-bundle] CSS gzip ${cssGzipBytes} B / ${limits.cssGzipBytes} B; WOFF2 ${fontBytes} B / ${limits.fontBytes} B; JS gzip report ${jsGzipBytes} B`,
);

if (cssGzipBytes > limits.cssGzipBytes) {
  console.error("[ui-bundle] Initial UI CSS exceeds the 80 KiB gzip budget.");
  process.exitCode = 1;
}
if (fontBytes > limits.fontBytes) {
  console.error("[ui-bundle] Initial WOFF2 transfer exceeds the 400 KiB budget.");
  process.exitCode = 1;
}
