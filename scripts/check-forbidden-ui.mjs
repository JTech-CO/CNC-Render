import { readFile, readdir } from "node:fs/promises";
import { extname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const uiRoots = ["app", "apps/web", "packages/ui"];
const includedExtensions = new Set([
  ".cjs",
  ".css",
  ".html",
  ".js",
  ".jsx",
  ".less",
  ".mjs",
  ".mts",
  ".sass",
  ".scss",
  ".ts",
  ".tsx",
]);
const ignoredDirectories = new Set([
  ".next",
  ".vinext",
  ".wrangler",
  "coverage",
  "dist",
  "node_modules",
]);
const forbiddenPatterns = [
  {
    label: "dark color-scheme media query",
    pattern: /prefers-color-scheme\s*:\s*dark/giu,
  },
  {
    label: "dark color-scheme declaration",
    pattern: /\bcolor-scheme\s*:\s*dark\b/giu,
  },
  {
    label: "dark theme attribute",
    pattern: /\bdata-theme\s*=\s*["']dark["']/giu,
  },
  {
    label: "background gradient",
    pattern: /\b(?:linear|radial|conic)-gradient\s*\(/giu,
  },
  {
    label: "backdrop filter",
    pattern: /\b(?:-webkit-)?backdrop-filter\s*:/giu,
  },
  {
    label: "blur filter",
    pattern: /\bfilter\s*:\s*[^;\n]*\bblur\s*\(/giu,
  },
  {
    label: "persistent CSS animation",
    pattern: /\banimation(?:-[\w-]+)?\s*:\s*(?!none\b)/giu,
  },
  {
    label: "CSS keyframes",
    pattern: /@(?:-webkit-)?keyframes\b/giu,
  },
  {
    label: "prohibited animation or skeleton dependency",
    pattern:
      /(?:react-loading-skeleton|framer-motion|lottie-web|@lottiefiles\/)/giu,
  },
  {
    label: "neon, glow, or bevel UI treatment",
    pattern: /\b(?:neon|glow|bevel)(?:ed|ing)?\b/giu,
  },
  {
    label: "circular gauge UI",
    pattern: /\b(?:circular|radial)[-_ ]?gauge\b/giu,
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

for (const uiRoot of uiRoots) {
  await collectFiles(resolve(repositoryRoot, uiRoot), files);
}

const violations = [];

for (const filePath of files.sort()) {
  const contents = await readFile(filePath, "utf8");

  for (const { label, pattern } of forbiddenPatterns) {
    pattern.lastIndex = 0;

    for (const match of contents.matchAll(pattern)) {
      const index = match.index ?? 0;
      violations.push({
        file: toRepositoryPath(filePath),
        line: lineNumberAt(contents, index),
        match: match[0],
        label,
      });
    }
  }
}

if (violations.length > 0) {
  console.error("[forbidden-ui] Prohibited UI implementation found:");
  for (const violation of violations) {
    console.error(
      `  ${violation.file}:${violation.line} ${violation.label}: ${JSON.stringify(violation.match)}`,
    );
  }
  process.exitCode = 1;
} else {
  console.log("[forbidden-ui] UI source complies with the M0 visual policy.");
}
