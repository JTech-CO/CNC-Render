import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createReleaseMetadata,
  readReleaseIdentity,
  resolveGitIdentity,
  validateReleaseMetadata,
  writeReleaseMetadata,
} from "../../scripts/release-metadata.mjs";
import { ENGINE_VERSION, PRODUCT_VERSION, SCHEMA_VERSION, WORKER_PROTOCOL_VERSION } from "@cnc-render/contracts";

const commitSha = "a".repeat(40);
const wasm = Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]);
const identity = {
  version: PRODUCT_VERSION,
  engineVersion: ENGINE_VERSION,
  schemaVersion: SCHEMA_VERSION,
  workerProtocolVersion: WORKER_PROTOCOL_VERSION,
  commitSha,
  sourceDirty: false,
};
const temporaryDirectories: string[] = [];

function artifact() {
  const directory = mkdtempSync(join(tmpdir(), "cnc-release-test-"));
  temporaryDirectories.push(directory);
  mkdirSync(join(directory, "wasm"));
  writeFileSync(join(directory, "wasm", "cnc_render_wasm.wasm"), wasm);
  writeReleaseMetadata(directory, "pages", identity);
  return directory;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("M12 release identity", () => {
  it("uses the checkout SHA, including a detached PR merge checkout", () => {
    expect(resolveGitIdentity(commitSha, "", commitSha, true)).toEqual({
      commitSha, sourceDirty: false,
    });
  });

  it.each(["", "1234567", "g".repeat(40), "a".repeat(64)])("rejects invalid or shortened SHA %s", (sha) => {
    expect(() => resolveGitIdentity(sha, "", undefined)).toThrow("full Git commit SHA");
  });

  it.each(["", "b".repeat(40), "1234567"])("rejects a mismatching CI SHA %s", (sha) => {
    expect(() => resolveGitIdentity(commitSha, "", sha)).toThrow("GITHUB_SHA");
  });

  it.each([" M app/page.tsx", "M  package.json", "?? new-source.ts"])("marks local modifications but blocks publishing: %s", (status) => {
    expect(resolveGitIdentity(commitSha, status, undefined)).toEqual({
      commitSha, sourceDirty: true,
    });
    expect(() => resolveGitIdentity(commitSha, status, undefined, true)).toThrow("clean");
  });

  it("reads the real repository versions and commit without leaking source names", () => {
    const actual = readReleaseIdentity({ environment: { NODE_ENV: "test" }, requireClean: false });
    expect(actual).toEqual({
      ...identity, commitSha: expect.stringMatching(/^[a-f0-9]{40}$/u), sourceDirty: expect.any(Boolean),
    });
  });

  it.each(["pages", "client"])("records canonical versions and compiled WASM integrity for %s", (target) => {
    expect(createReleaseMetadata(identity, target, wasm)).toEqual({
      metadataVersion: 1, ...identity, target,
      wasm: { path: "wasm/cnc_render_wasm.wasm", byteLength: 8, sha256: createHash("sha256").update(wasm).digest("hex") },
    });
  });

  it("rejects unknown targets and non-WASM assets", () => {
    expect(() => createReleaseMetadata(identity, "other", wasm)).toThrow("target");
    expect(() => createReleaseMetadata(identity, "pages", Buffer.from("not wasm"))).toThrow("WASM");
    expect(() => createReleaseMetadata(identity, "pages", wasm.subarray(0, 7))).toThrow("WASM");
  });

  it("writes deterministic metadata and validates the actual artifact bytes", () => {
    const directory = artifact();
    const first = readFileSync(join(directory, "release.json"), "utf8");
    writeReleaseMetadata(directory, "pages", identity);
    expect(readFileSync(join(directory, "release.json"), "utf8")).toBe(first);
    expect(validateReleaseMetadata(directory, "pages", identity)).toEqual(JSON.parse(first));
  });

  it.each([
    ["version", "99.0.0"], ["engineVersion", "99.0.0"], ["schemaVersion", 99],
    ["workerProtocolVersion", 99], ["commitSha", "b".repeat(40)], ["sourceDirty", true],
    ["target", "client"], ["metadataVersion", 99], ["privateProjectName", "must-not-appear"],
  ])("rejects altered or extra metadata field %s", (key, value) => {
    const directory = artifact();
    const data = JSON.parse(readFileSync(join(directory, "release.json"), "utf8"));
    data[key] = value;
    writeFileSync(join(directory, "release.json"), JSON.stringify(data));
    expect(() => validateReleaseMetadata(directory, "pages", identity)).toThrow("does not match");
  });

  it("rejects altered WASM bytes, missing metadata, invalid JSON and missing assets", () => {
    const directory = artifact();
    const binaryPath = join(directory, "wasm", "cnc_render_wasm.wasm");
    writeFileSync(binaryPath, Buffer.concat([wasm, Buffer.from([0, 1, 0])]));
    expect(() => validateReleaseMetadata(directory, "pages", identity)).toThrow("does not match");
    writeFileSync(join(directory, "release.json"), "{}");
    expect(() => validateReleaseMetadata(directory, "pages", identity)).toThrow("does not match");
    writeFileSync(join(directory, "release.json"), "{");
    expect(() => validateReleaseMetadata(directory, "pages", identity)).toThrow();
    writeReleaseMetadata(directory, "pages", identity);
    rmSync(binaryPath);
    expect(() => validateReleaseMetadata(directory, "pages", identity)).toThrow();
    rmSync(join(directory, "release.json"));
    expect(() => validateReleaseMetadata(directory, "pages", identity)).toThrow();
  });
});
