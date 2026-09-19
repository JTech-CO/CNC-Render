import { describe, expect, it } from "vitest";
import { fingerprintEntries, isRuntimeSource } from "../../scripts/runtime-fingerprint.mjs";

describe("M12 reference evidence source identity", () => {
  it("includes runtime, toolchain and build inputs but excludes docs and test output", () => {
    for (const path of ["app/page.tsx", "apps/pages-demo/index.html", "packages/renderer/src/stock-surface.ts", "crates/stock-core/src/lib.rs", "pnpm-lock.yaml", "scripts/build-wasm.mjs"]) expect(isRuntimeSource(path)).toBe(true);
    for (const path of ["PROGRESS.md", "docs/verification/m12-reference-evidence.json", "artifacts/report.json", "packages/e2e/tests/reference-resources.spec.ts", "node_modules/a.js"]) expect(isRuntimeSource(path)).toBe(false);
  });
  it("is independent of enumeration order but detects source/path changes", () => {
    const entries = [["app/a.ts", "a".repeat(40)], ["app/b.ts", "b".repeat(40)]];
    expect(fingerprintEntries(entries)).toEqual(fingerprintEntries([...entries].reverse()));
    expect(fingerprintEntries(entries).sha256).not.toBe(fingerprintEntries([["app/a.ts", "c".repeat(40)], entries[1]]).sha256);
  });
  it("rejects missing, duplicate and malformed identities", () => {
    expect(() => fingerprintEntries([])).toThrow();
    expect(() => fingerprintEntries([["a", "invalid"]])).toThrow();
    expect(() => fingerprintEntries([["a", "a".repeat(40)], ["a", "a".repeat(40)]])).toThrow();
  });
});
