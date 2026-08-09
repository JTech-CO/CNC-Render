import { spawn, spawnSync } from "node:child_process";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer, request as createProxyRequest } from "node:http";
import { dirname, extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const packageDirectory = dirname(fileURLToPath(import.meta.url));
const workspaceDirectory = resolve(packageDirectory, "../..");
const clientDirectory = resolve(workspaceDirectory, "dist/client");
const buildScript = resolve(
  workspaceDirectory,
  "scripts/run-vinext-build.mjs",
);
const vinextCli = resolve(
  workspaceDirectory,
  "node_modules/vinext/dist/cli.js",
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

const server = spawn(
  process.execPath,
  [
    vinextCli,
    "start",
    "--hostname",
    "127.0.0.1",
    "--port",
    "43174",
  ],
  {
    cwd: workspaceDirectory,
    env: process.env,
    stdio: "inherit",
  },
);
let stopping = false;

const contentTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".js", "application/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".webp", "image/webp"],
  [".woff2", "font/woff2"],
]);

async function serveClientAsset(request, response, pathname) {
  let decodedPathname;
  try {
    decodedPathname = decodeURIComponent(pathname);
  } catch {
    response.writeHead(400).end("Bad Request");
    return;
  }

  const filePath = resolve(clientDirectory, `.${decodedPathname}`);
  if (
    filePath !== clientDirectory &&
    !filePath.startsWith(`${clientDirectory}${sep}`)
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
      "Cache-Control": "public, max-age=31536000, immutable",
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
}

function proxyToVinext(request, response) {
  const proxyRequest = createProxyRequest(
    {
      headers: {
        ...request.headers,
        host: "127.0.0.1:43174",
      },
      hostname: "127.0.0.1",
      method: request.method,
      path: request.url,
      port: 43174,
    },
    (proxyResponse) => {
      response.writeHead(
        proxyResponse.statusCode ?? 502,
        proxyResponse.headers,
      );
      proxyResponse.pipe(response);
    },
  );
  proxyRequest.on("error", () => {
    if (!response.headersSent) {
      response.writeHead(503, { "Retry-After": "1" });
    }
    response.end("Vinext is starting");
  });
  request.pipe(proxyRequest);
}

const gateway = createServer((request, response) => {
  const pathname = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
  if (
    pathname.startsWith("/assets/") ||
    pathname.startsWith("/wasm/")
  ) {
    void serveClientAsset(request, response, pathname);
    return;
  }
  proxyToVinext(request, response);
});

gateway.listen(43173, "127.0.0.1", () => {
  console.log("[e2e-server] listening on http://127.0.0.1:43173");
});

function stopServer() {
  if (stopping) {
    return;
  }
  stopping = true;
  gateway.close();

  if (server.exitCode !== null) {
    return;
  }
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(server.pid), "/T", "/F"], {
      stdio: "ignore",
    });
  } else {
    server.kill("SIGTERM");
  }
}

process.once("SIGINT", stopServer);
process.once("SIGTERM", stopServer);
process.once("exit", stopServer);

server.once("error", (error) => {
  console.error(`[e2e-server] ${error.message}`);
  process.exitCode = 1;
});
server.once("exit", (code, signal) => {
  if (!stopping) {
    stopping = true;
    gateway.close();
  }
  if (signal) {
    process.exitCode = 1;
  } else {
    process.exitCode = code ?? 0;
  }
});
