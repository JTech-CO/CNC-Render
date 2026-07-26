import { readFile, readdir } from "node:fs/promises";
import { extname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const sourceRoots = ["docs", "apps", "packages", "crates"];
const includedExtensions = new Set([
  ".cjs",
  ".css",
  ".html",
  ".js",
  ".json",
  ".jsx",
  ".md",
  ".mjs",
  ".mts",
  ".rs",
  ".scss",
  ".toml",
  ".ts",
  ".tsx",
  ".yaml",
  ".yml",
]);
const ignoredDirectories = new Set([
  ".next",
  ".vinext",
  ".wrangler",
  "coverage",
  "dist",
  "node_modules",
  "pkg",
  "target",
]);
const forbiddenTerms = [
  {
    label: "legacy CNCverse product name",
    pattern: /\bCNCverse\b/giu,
  },
  {
    label: "legacy .cncverse extension",
    pattern: /\.cncverse\b/giu,
  },
  {
    label: "unsupported English dark mode terminology",
    pattern: /\bdark\s+mode\b/giu,
  },
  {
    label: "unsupported Korean dark mode terminology",
    pattern: /다크\s*모드/gu,
  },
];

function toRepositoryPath(filePath) {
  return relative(repositoryRoot, filePath).split(sep).join("/");
}

async function collectFiles(directoryPath, files = []) {
  const entries = await readdir(directoryPath, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.isSymbolicLink()) {
      continue;
    }

    const entryPath = resolve(directoryPath, entry.name);

    if (entry.isDirectory()) {
      if (!ignoredDirectories.has(entry.name)) {
        await collectFiles(entryPath, files);
      }
      continue;
    }

    if (entry.isFile() && includedExtensions.has(extname(entry.name))) {
      files.push(entryPath);
    }
  }

  return files;
}

function lineNumberAt(contents, index) {
  return contents.slice(0, index).split("\n").length;
}

const files = [];

for (const sourceRoot of sourceRoots) {
  await collectFiles(resolve(repositoryRoot, sourceRoot), files);
}

const violations = [];

for (const filePath of files.sort()) {
  const repositoryPath = toRepositoryPath(filePath);
  const contents = await readFile(filePath, "utf8");

  for (const { label, pattern } of forbiddenTerms) {
    pattern.lastIndex = 0;

    for (const match of contents.matchAll(pattern)) {
      const index = match.index ?? 0;
      violations.push({
        file: repositoryPath,
        line: lineNumberAt(contents, index),
        match: match[0],
        label,
      });
    }
  }
}

if (violations.length > 0) {
  console.error("[doc-terms] Forbidden terminology found:");
  for (const violation of violations) {
    console.error(
      `  ${violation.file}:${violation.line} ${violation.label}: ${JSON.stringify(violation.match)}`,
    );
  }
  process.exitCode = 1;
} else {
  console.log(
    "[doc-terms] Canonical documentation and source terminology is consistent.",
  );
}
