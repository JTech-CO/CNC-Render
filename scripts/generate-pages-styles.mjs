import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const stylePairs = [
  {
    source: "packages/ui/src/generated/tokens.css",
    output: "public/styles/tokens.css",
  },
  {
    source: "packages/ui/src/primitives.css",
    output: "public/styles/primitives.css",
  },
];
const checkOnly = process.argv.includes("--check");

function normalize(contents) {
  return contents.replaceAll("\r\n", "\n").trimEnd();
}

for (const pair of stylePairs) {
  const sourcePath = resolve(repositoryRoot, pair.source);
  const outputPath = resolve(repositoryRoot, pair.output);
  const expected = `${normalize(await readFile(sourcePath, "utf8"))}\n`;

  if (checkOnly) {
    const current = await readFile(outputPath, "utf8").catch(() => "");
    if (normalize(current) !== normalize(expected)) {
      throw new Error(
        `GitHub Pages stylesheet is stale: ${pair.output}. Run pnpm generate:pages-styles.`,
      );
    }
  } else {
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, expected, "utf8");
  }
}

console.log(
  `[pages-styles] ${checkOnly ? "verified" : "generated"} ${stylePairs.length} sources`,
);
