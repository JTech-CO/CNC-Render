import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";

export function isRuntimeSource(path) {
  if (path.startsWith("packages/e2e/")) return false;
  return /^(app|apps|packages|crates|content|shaders|public)\//u.test(path) ||
    /^(package\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml|Cargo\.(toml|lock)|rust-toolchain\.toml|tsconfig[^/]*\.json|vite[^/]*\.[cm]?ts|next\.config\.[cm]?ts)$/u.test(path) ||
    /^scripts\/(build-wasm|run-github-pages-build|generate-pages-styles|release-metadata|generate-design-tokens|run-vinext-build)\.mjs$/u.test(path);
}

export function fingerprintEntries(entries) {
  const sorted = [...entries].sort(([left], [right]) => left.localeCompare(right, "en"));
  if (!sorted.length || new Set(sorted.map(([path]) => path)).size !== sorted.length || sorted.some(([path, hash]) => !path || !/^[a-f0-9]{40}$/u.test(hash))) throw new Error("Invalid runtime source entries");
  const sha256 = createHash("sha256");
  for (const [path, hash] of sorted) sha256.update(`${path}\0${hash}\n`);
  return { algorithm: "git-normalized-source-sha256-v1", fileCount: sorted.length, sha256: sha256.digest("hex") };
}

export function runtimeFingerprint(cwd = process.cwd()) {
  const paths = [...new Set(execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], { cwd, encoding: "utf8" }).split("\0").filter(isRuntimeSource))].sort();
  // Git clean filters normalize Windows CRLF exactly as they do on commit.
  const hashes = execFileSync("git", ["hash-object", "--stdin-paths"], { cwd, encoding: "utf8", input: paths.map((path) => JSON.stringify(path)).join("\n") + "\n" }).trim().split(/\r?\n/u);
  if (hashes.length !== paths.length) throw new Error("Incomplete source fingerprint");
  return fingerprintEntries(paths.map((path, index) => [path, hashes[index]]));
}
