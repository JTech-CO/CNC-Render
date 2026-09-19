import { resolve } from "node:path";
import { readReleaseIdentity, validateReleaseMetadata } from "./release-metadata.mjs";

const args = process.argv.slice(2);
const targetFlags = args.filter((arg) => arg.startsWith("--target="));
if (targetFlags.length !== 1 || args.some((arg) =>
  arg !== "--require-clean" && arg !== "--target=pages" && arg !== "--target=client")) {
  throw new Error("Usage: check-release.mjs --target=pages|client [--require-clean]");
}
const target = targetFlags[0].slice("--target=".length);
const identity = readReleaseIdentity({
  requireClean: args.includes("--require-clean") || process.env.GITHUB_ACTIONS === "true",
});
const metadata = validateReleaseMetadata(resolve("dist", target), target, identity);
console.info(`[release] ${target}: v${metadata.version}, ${metadata.commitSha}, schema ${metadata.schemaVersion}, engine ${metadata.engineVersion}, dirty=${metadata.sourceDirty}; WASM SHA-256 verified.`);
