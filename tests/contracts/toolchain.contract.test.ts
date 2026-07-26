import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const EXPECTED = {
  node: "24.18.0",
  pnpm: "11.5.3",
  rust: "1.97.1",
} as const;

describe("M0 toolchain pinning", () => {
  it("keeps local and CI versions aligned", async () => {
    const [toolVersions, rustToolchain, workflow] = await Promise.all([
      readFile(".tool-versions", "utf8"),
      readFile("rust-toolchain.toml", "utf8"),
      readFile(".github/workflows/ci.yml", "utf8"),
    ]);

    expect(toolVersions).toContain(`nodejs ${EXPECTED.node}`);
    expect(toolVersions).toContain(`pnpm ${EXPECTED.pnpm}`);
    expect(toolVersions).toContain(`rust ${EXPECTED.rust}`);
    expect(rustToolchain).toContain(`channel = "${EXPECTED.rust}"`);
    expect(workflow).toContain(`NODE_VERSION: ${EXPECTED.node}`);
    expect(workflow).toContain(`PNPM_VERSION: ${EXPECTED.pnpm}`);
    expect(workflow).toContain(`RUST_VERSION: ${EXPECTED.rust}`);
    expect(workflow).toContain(
      "dependency-cruiser --config dependency-cruiser.config.cjs",
    );
    expect(workflow).toContain("node scripts/check-doc-terms.mjs");
  });
});
