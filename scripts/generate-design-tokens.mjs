import { readFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const sourcePath = resolve(
  repositoryRoot,
  "design/tokens/cnc-render.tokens.json",
);
const cssPath = resolve(
  repositoryRoot,
  "packages/ui/src/generated/tokens.css",
);
const typescriptPath = resolve(
  repositoryRoot,
  "packages/ui/src/generated/tokens.ts",
);
const checkOnly = process.argv.includes("--check");

const document = JSON.parse(await readFile(sourcePath, "utf8"));
const entries = Object.values(document.tokens).flatMap((group) =>
  Object.entries(group),
);
const values = Object.fromEntries(
  entries.map(([name, token]) => [name, token.$value]),
);

const css = [
  "/* Generated from design/tokens/cnc-render.tokens.json. Do not edit. */",
  ":root {",
  "  color-scheme: light;",
  ...Object.entries(values).map(
    ([name, value]) => `  --${name}: ${String(value)};`,
  ),
  "}",
  "",
].join("\n");

const typescript = [
  "/* Generated from design/tokens/cnc-render.tokens.json. Do not edit. */",
  `export const designTokens = ${JSON.stringify(values, null, 2)} as const;`,
  "",
  "export type DesignTokenName = keyof typeof designTokens;",
  "",
].join("\n");

async function update(path, expected) {
  if (checkOnly) {
    const current = await readFile(path, "utf8").catch(() => "");
    if (current.replaceAll("\r\n", "\n") !== expected) {
      throw new Error(
        `Generated token artifact is stale: ${path.slice(repositoryRoot.length + 1)}`,
      );
    }
    return;
  }
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, expected, "utf8");
}

await update(cssPath, css);
await update(typescriptPath, typescript);
console.log(
  `[design-tokens] ${checkOnly ? "verified" : "generated"} ${entries.length} tokens`,
);
