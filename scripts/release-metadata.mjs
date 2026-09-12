import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { fileURLToPath } from "node:url";
import {
  ENGINE_VERSION,
  PRODUCT_VERSION,
  SCHEMA_VERSION,
  WORKER_PROTOCOL_VERSION,
} from "../packages/contracts/src/constants.ts";

/** Resolve the checked-out commit, never a PR head or an unverified CI label. */
export function resolveGitIdentity(head, status, githubSha, requireClean = false) {
  if (!/^[a-f0-9]{40}$/u.test(head)) {
    throw new Error("Release identity requires a full Git commit SHA.");
  }
  if (githubSha !== undefined && githubSha !== head) {
    throw new Error("GITHUB_SHA does not match the checked-out commit.");
  }
  const sourceDirty = status.length > 0;
  if (requireClean && sourceDirty) {
    throw new Error("Release publishing requires a clean tracked/untracked worktree.");
  }
  return { commitSha: head, sourceDirty };
}

export function readReleaseIdentity({
  root = fileURLToPath(new URL("../", import.meta.url)),
  environment = process.env,
  requireClean = environment.GITHUB_ACTIONS === "true",
} = {}) {
  const git = (args) => execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
  const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  if (manifest.version !== PRODUCT_VERSION || ENGINE_VERSION !== PRODUCT_VERSION) {
    throw new Error("Release product/engine versions disagree with package.json.");
  }
  return {
    version: PRODUCT_VERSION,
    engineVersion: ENGINE_VERSION,
    schemaVersion: SCHEMA_VERSION,
    workerProtocolVersion: WORKER_PROTOCOL_VERSION,
    ...resolveGitIdentity(
      git(["rev-parse", "--verify", "HEAD"]),
      git(["status", "--porcelain=v1", "--untracked-files=all"]),
      environment.GITHUB_SHA,
      requireClean,
    ),
  };
}

export function createReleaseMetadata(identity, target, wasmBytes) {
  if (target !== "pages" && target !== "client") {
    throw new Error("Release target must be pages or client.");
  }
  // Check the compiled asset rather than the intermediate public/wasm copy.
  if (wasmBytes.length < 8 ||
      !Buffer.from(wasmBytes.subarray(0, 8)).equals(Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]))) {
    throw new Error("Release asset must contain a version 1 WASM binary.");
  }
  return {
    metadataVersion: 1,
    ...identity,
    target,
    wasm: {
      path: "wasm/cnc_render_wasm.wasm",
      byteLength: wasmBytes.length,
      sha256: createHash("sha256").update(wasmBytes).digest("hex"),
    },
  };
}

export function writeReleaseMetadata(directory, target, identity = readReleaseIdentity()) {
  const metadata = createReleaseMetadata(
    identity, target, readFileSync(join(directory, "wasm", "cnc_render_wasm.wasm")),
  );
  // No timestamp, hostname, branch name, project title or source content.
  writeFileSync(join(directory, "release.json"), JSON.stringify(metadata, null, 2) + "\n");
  return metadata;
}

export function validateReleaseMetadata(directory, target, identity = readReleaseIdentity()) {
  const actual = JSON.parse(readFileSync(join(directory, "release.json"), "utf8"));
  const expected = createReleaseMetadata(
    identity, target, readFileSync(join(directory, "wasm", "cnc_render_wasm.wasm")),
  );
  if (!isDeepStrictEqual(actual, expected)) {
    throw new Error("release.json does not match the current source identity and built WASM asset.");
  }
  return actual;
}
