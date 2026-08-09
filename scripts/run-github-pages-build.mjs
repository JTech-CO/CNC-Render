import { existsSync, readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const workspacePath = process.cwd();
const repository = process.env.GITHUB_REPOSITORY ?? "JTech-CO/CNC-Render";
const [owner, repositoryName, ...unexpectedParts] = repository.split("/");

if (!owner || !repositoryName || unexpectedParts.length > 0) {
  throw new Error(
    "GITHUB_REPOSITORY must have the form owner/repository, received " +
      repository +
      ".",
  );
}

const basePath = "/" + repositoryName;
const publicOrigin =
  "https://" + owner.toLowerCase() + ".github.io" + basePath;

function runNode(entryPath, argumentsList = [], environment = process.env) {
  const result = spawnSync(process.execPath, [entryPath, ...argumentsList], {
    cwd: workspacePath,
    env: environment,
    stdio: "inherit",
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

runNode(
  join(workspacePath, "scripts", "generate-pages-styles.mjs"),
  ["--check"],
);
runNode(join(workspacePath, "scripts", "build-wasm.mjs"));

const viteCliPath = fileURLToPath(
  new URL("../node_modules/vite/bin/vite.js", import.meta.url),
);
runNode(
  viteCliPath,
  ["build", "--config", join(workspacePath, "vite.pages.config.ts")],
  {
    ...process.env,
    CNC_RENDER_BASE_PATH: basePath,
    VITE_CNC_RENDER_PUBLIC_ORIGIN: publicOrigin,
  },
);

const pagesDirectory = join(workspacePath, "dist", "pages");
const indexPath = join(pagesDirectory, "index.html");
const wasmPath = join(pagesDirectory, "wasm", "cnc_render_wasm.wasm");
const assetsDirectory = join(pagesDirectory, "assets");
const tokenStylesPath = join(pagesDirectory, "styles", "tokens.css");
const primitiveStylesPath = join(pagesDirectory, "styles", "primitives.css");

if (!existsSync(indexPath)) {
  throw new Error("GitHub Pages build did not produce dist/pages/index.html.");
}
if (!existsSync(wasmPath)) {
  throw new Error(
    "GitHub Pages build did not publish dist/pages/wasm/cnc_render_wasm.wasm.",
  );
}
if (!existsSync(assetsDirectory)) {
  throw new Error("GitHub Pages build did not produce dist/pages/assets.");
}

const tokenStyles = readFileSync(tokenStylesPath, "utf8");
const primitiveStyles = readFileSync(primitiveStylesPath, "utf8");
if (!/--app-bg:\s*#f4f6f8/u.test(tokenStyles)) {
  throw new Error("GitHub Pages CSS does not include the generated design tokens.");
}
if (
  !primitiveStyles.includes(".ui-button") ||
  !primitiveStyles.includes(".ui-dialog")
) {
  throw new Error("GitHub Pages CSS does not include the shared UI primitives.");
}

const indexHtml = readFileSync(indexPath, "utf8");
for (const stylesheet of [
  "styles/tokens.css",
  "styles/primitives.css",
]) {
  if (!indexHtml.includes(basePath + "/" + stylesheet)) {
    throw new Error("GitHub Pages does not reference " + stylesheet + ".");
  }
}
if (!indexHtml.includes(basePath + "/assets/")) {
  throw new Error(
    "GitHub Pages build does not reference assets below " +
      basePath +
      "/assets/.",
  );
}
if (/(?:src|href)="\/assets\//u.test(indexHtml)) {
  throw new Error("GitHub Pages build contains a root-relative asset URL.");
}
if (!indexHtml.includes(publicOrigin + "/og.png")) {
  throw new Error(
    "GitHub Pages metadata does not reference " + publicOrigin + "/og.png.",
  );
}

const workerFile = readdirSync(assetsDirectory).find(
  (name) => name.startsWith("simulation.worker-") && name.endsWith(".js"),
);
if (!workerFile) {
  throw new Error("GitHub Pages build did not emit the simulation Worker.");
}
const workerSource = readFileSync(join(assetsDirectory, workerFile), "utf8");
if (
  !workerSource.includes(basePath + "/") ||
  !workerSource.includes("wasm/cnc_render_wasm.wasm")
) {
  throw new Error(
    "GitHub Pages Worker does not reference the project-scoped WASM URL.",
  );
}

console.info(
  "[build:pages] Validated static demo for " +
    publicOrigin +
    "/ with Worker and WASM assets.",
);
