import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const packagePaths = [
  "package.json",
  "apps/web/package.json",
  "packages/contracts/package.json",
  "packages/renderer/package.json",
  "packages/simulation/package.json",
  "packages/storage/package.json",
  "packages/ui/package.json",
  "packages/e2e/package.json",
];
const cratePaths = [
  "crates/cnc-render-foundation/Cargo.toml",
  "crates/cnc-render-contracts/Cargo.toml",
  "crates/gcode-core/Cargo.toml",
  "crates/simulation-core/Cargo.toml",
  "crates/cnc-render-wasm/Cargo.toml",
];
const errors = [];

async function source(relativePath) {
  return readFile(resolve(repositoryRoot, relativePath), "utf8");
}

const rootManifest = JSON.parse(await source("package.json"));
const productVersion = rootManifest.version;
if (!/^\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?$/u.test(productVersion ?? "")) {
  errors.push("package.json version must be normalized SemVer.");
}

for (const packagePath of packagePaths) {
  const manifest = JSON.parse(await source(packagePath));
  if (manifest.version !== productVersion) {
    errors.push(
      `${packagePath} version ${JSON.stringify(manifest.version)} must match ${productVersion}.`,
    );
  }
}

const cargoWorkspace = await source("Cargo.toml");
const cargoVersion = /\[workspace\.package\][\s\S]*?^version\s*=\s*"([^"]+)"/mu.exec(
  cargoWorkspace,
)?.[1];
if (cargoVersion !== productVersion) {
  errors.push(
    `Cargo workspace version ${JSON.stringify(cargoVersion)} must match ${productVersion}.`,
  );
}

for (const cratePath of cratePaths) {
  const manifest = await source(cratePath);
  if (!/^version\.workspace\s*=\s*true\s*$/mu.test(manifest)) {
    errors.push(`${cratePath} must inherit version.workspace.`);
  }
  if (/^version\s*=\s*"/mu.test(manifest)) {
    errors.push(`${cratePath} must not declare a divergent package version.`);
  }
}

const constants = await source("packages/contracts/src/constants.ts");
const sourceVersion = /PRODUCT_VERSION\s*=\s*"([^"]+)"/u.exec(constants)?.[1];
if (sourceVersion !== productVersion) {
  errors.push(
    `PRODUCT_VERSION ${JSON.stringify(sourceVersion)} must match ${productVersion}.`,
  );
}

const runtimeContracts = [
  ["packages/simulation/src/coordinator.ts", "clientVersion: PRODUCT_VERSION"],
  ["packages/simulation/src/simulation.worker.ts", "coreVersion: PRODUCT_VERSION"],
  ["app/components/m8-persistence-adapter.ts", "ENGINE_VERSION"],
  ["app/components/workspace-shell.tsx", "v{PRODUCT_VERSION}"],
];
for (const [relativePath, marker] of runtimeContracts) {
  if (!(await source(relativePath)).includes(marker)) {
    errors.push(`${relativePath} must use the shared version marker ${marker}.`);
  }
}

if (errors.length > 0) {
  console.error("[versions] Version contract failed:");
  for (const error of errors) {
    console.error(`  - ${error}`);
  }
  process.exitCode = 1;
} else {
  console.log(
    `[versions] Product, engine, 8 JS manifests, and 5 Rust crates match ${productVersion}; schema/protocol remain independent.`,
  );
}
