import { spawnSync } from "node:child_process";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const packageDirectory = dirname(fileURLToPath(import.meta.url));
const workspaceDirectory = resolve(packageDirectory, "../..");
const pagesDirectory = resolve(workspaceDirectory, "dist/pages");
const basePath = "/CNC-Render";
const buildScript = resolve(
  workspaceDirectory,
  "scripts/run-github-pages-build.mjs",
);

const build = spawnSync(process.execPath, [buildScript], {
  cwd: workspaceDirectory,
  env: process.env,
  stdio: "inherit",
});
if (build.error) {
  throw build.error;
}
if (build.status !== 0) {
  process.exit(build.status ?? 1);
}

const contentTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".js", "application/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".wasm", "application/wasm"],
  [".webp", "image/webp"],
  [".woff2", "font/woff2"],
]);

function responsePath(pathname) {
  if (pathname === basePath || pathname === `${basePath}/`) {
    return "index.html";
  }
  if (!pathname.startsWith(`${basePath}/`)) {
    return null;
  }
  try {
    return decodeURIComponent(pathname.slice(basePath.length + 1));
  } catch {
    return null;
  }
}

const server = createServer(async (request, response) => {
  const pathname = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
  const relativePath = responsePath(pathname);
  if (!relativePath || relativePath.includes("\\")) {
    response.writeHead(404).end("Not Found");
    return;
  }

  const filePath = resolve(pagesDirectory, relativePath);
  if (
    filePath !== pagesDirectory &&
    !filePath.startsWith(`${pagesDirectory}${sep}`)
  ) {
    response.writeHead(404).end("Not Found");
    return;
  }

  try {
    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) {
      response.writeHead(404).end("Not Found");
      return;
    }
    response.writeHead(200, {
      "Cache-Control": "no-store",
      "Content-Length": String(fileStat.size),
      "Content-Type":
        contentTypes.get(extname(filePath)) ?? "application/octet-stream",
    });
    if (request.method === "HEAD") {
      response.end();
      return;
    }
    createReadStream(filePath).pipe(response);
  } catch {
    response.writeHead(404).end("Not Found");
  }
});

server.listen(43175, "127.0.0.1", () => {
  console.log(
    "[pages-e2e-server] listening on http://127.0.0.1:43175/CNC-Render/",
  );
});

function stopServer() {
  server.close();
}

process.once("SIGINT", stopServer);
process.once("SIGTERM", stopServer);
