import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { ToolpathIRSchema } from "@cnc-render/contracts";
import {
  loadGcodeFixtureManifests,
  parseGcodeFixture,
  runGcodeCli,
  unwrapGcodeResult,
} from "../helpers/gcode-cli.mjs";

type SupportEntry = {
  code: string;
  status: string;
};

type WordSupportEntry = {
  word: string;
  status: string;
};

type SupportMatrix = {
  gCodes: SupportEntry[];
  mCodes: SupportEntry[];
  words: WordSupportEntry[];
  diagnosticCodes: string[];
};

const repositoryPackage = JSON.parse(
  readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
) as { scripts: Record<string, string> };
const workflow = readFileSync(
  new URL("../../.github/workflows/ci.yml", import.meta.url),
  "utf8",
);
const supportMatrix = JSON.parse(
  readFileSync(
    new URL("../fixtures/gcode/support-matrix.json", import.meta.url),
    "utf8",
  ),
) as SupportMatrix;
const supportMatrixDocument = readFileSync(
  new URL("../../docs/gcode-support-matrix.md", import.meta.url),
  "utf8",
);
const manifests = loadGcodeFixtureManifests();

function unwrapSupportMatrix(response: unknown) {
  if (typeof response !== "object" || response === null) {
    return response;
  }

  const candidate = response as Record<string, unknown>;
  const result =
    typeof candidate.result === "object" && candidate.result !== null
      ? (candidate.result as Record<string, unknown>)
      : candidate;
  return result.supportMatrix ?? result;
}

function documentedStatuses(markdown: string) {
  const statuses = new Map<string, string>();

  for (const line of markdown.split(/\r?\n/u)) {
    const cells = line
      .split("|")
      .slice(1, -1)
      .map((cell) => cell.trim());
    if (cells.length < 2) {
      continue;
    }

    const status = /^`([^`]+)`$/u.exec(cells[1])?.[1];
    if (status === undefined) {
      continue;
    }

    for (const match of cells[0].matchAll(/`([^`]+)`/gu)) {
      statuses.set(match[1], status);
    }
  }

  return statuses;
}

describe("toolpath-ir gcode contracts", () => {
  it(
    "toolpath-ir accepts every ToolpathIR emitted by accepted fixtures",
    () => {
      const accepted = manifests.filter(
        (manifest) => manifest.expected.accepted,
      );
      expect(accepted.length).toBeGreaterThan(0);

      for (const manifest of accepted) {
        const result = unwrapGcodeResult(parseGcodeFixture(manifest));
        const parsed = ToolpathIRSchema.parse(result.toolpath);
        expect(parsed.sourceLineMap).toHaveLength(parsed.segments.length);
        expect(new Set(parsed.sourceLineMap.map((entry) => entry.segmentId))).toEqual(
          new Set(parsed.segments.map((segment) => segment.id)),
        );
      }
    },
    120_000,
  );

  it(
    "toolpath-ir keeps the support matrix identical in code, fixture, and docs",
    () => {
      const response = runGcodeCli({ action: "support-matrix" });
      expect(unwrapSupportMatrix(response)).toEqual(supportMatrix);

      const entries = [
        ...supportMatrix.gCodes.map(({ code, status }) => ({ token: code, status })),
        ...supportMatrix.mCodes.map(({ code, status }) => ({ token: code, status })),
        ...supportMatrix.words.map(({ word, status }) => ({ token: word, status })),
      ];
      const statuses = documentedStatuses(supportMatrixDocument);

      expect(entries.length).toBeGreaterThan(0);
      expect(new Set(entries.map(({ token }) => token)).size).toBe(entries.length);
      for (const entry of entries) {
        expect(statuses.get(entry.token), entry.token).toBe(entry.status);
      }
      for (const diagnosticCode of supportMatrix.diagnosticCodes) {
        expect(supportMatrixDocument).toContain(`\`${diagnosticCode}\``);
      }
    },
    120_000,
  );

  it("toolpath-ir exposes exact M2 gate commands", () => {
    expect(repositoryPackage.scripts["fuzz:gcode"]).toBe(
      "node scripts/fuzz-gcode.mjs",
    );
    expect(workflow).toContain("pnpm test:unit --filter gcode");
    expect(workflow).toContain("pnpm test:contracts --filter toolpath-ir");
    expect(workflow).toContain("pnpm test:parity --filter gcode");
    expect(workflow).toContain("pnpm cargo:check");
    expect(workflow).toContain("pnpm fuzz:gcode -- --time=60");
  });
});
