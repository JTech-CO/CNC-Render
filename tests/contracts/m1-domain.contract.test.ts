import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  PROJECT_SCHEMA_ID,
  ProjectSchema,
  UiStoreSnapshotSchema,
  parseProject,
} from "@cnc-render/contracts";

type InvalidMutation = {
  name: string;
  path: Array<string | number>;
  value: unknown;
};

const validProject = JSON.parse(
  readFileSync(
    new URL("../fixtures/m1/valid-project.json", import.meta.url),
    "utf8",
  ),
) as Record<string, unknown>;
const invalidMutations = JSON.parse(
  readFileSync(
    new URL("../fixtures/m1/invalid-projects.json", import.meta.url),
    "utf8",
  ),
) as InvalidMutation[];

function setAtPath(
  root: Record<string, unknown>,
  path: Array<string | number>,
  value: unknown,
) {
  let cursor: unknown = root;
  for (const segment of path.slice(0, -1)) {
    cursor = (cursor as Record<string | number, unknown>)[segment];
  }
  (cursor as Record<string | number, unknown>)[path.at(-1)!] = value;
}

describe("schema M1 domain contracts", () => {
  it("schema accepts the canonical version 1 project fixture", () => {
    const project = parseProject(validProject);
    expect(project.$schema).toBe(PROJECT_SCHEMA_ID);
    expect(project.schemaVersion).toBe(1);
    expect(ProjectSchema.parse(JSON.parse(JSON.stringify(project)))).toEqual(
      project,
    );
  });

  it.each(invalidMutations)(
    "schema rejects $name",
    ({ path, value }) => {
      const candidate = structuredClone(validProject);
      setAtPath(candidate, path, value);
      expect(ProjectSchema.safeParse(candidate).success).toBe(false);
    },
  );

  it("schema rejects NaN, Infinity, negative zero, and unknown fields", () => {
    for (const invalidNumber of [
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
      -0,
    ]) {
      const candidate = structuredClone(validProject);
      setAtPath(
        candidate,
        ["stocks", 0, "transform", "positionMm", "xMm"],
        invalidNumber,
      );
      expect(ProjectSchema.safeParse(candidate).success).toBe(false);
    }

    const withUnknownField = {
      ...structuredClone(validProject),
      executablePluginUrl: "https://example.invalid/plugin.js",
    };
    expect(ProjectSchema.safeParse(withUnknownField).success).toBe(false);
  });

  it("schema keeps the UI Store contract free of binary simulation state", () => {
    const snapshot = {
      projectId: null,
      machineId: null,
      selectedToolAssemblyId: null,
      activeRunId: null,
      playback: {
        status: "idle",
        speedRatio: 1,
        timeS: 0,
      },
      summary: {
        sequence: 0,
        toolPositionMm: null,
        stockRevision: 0,
        progressRatio: 0,
      },
      diagnosticCodes: [],
      binaryHandleIds: [],
    };
    expect(UiStoreSnapshotSchema.safeParse(snapshot).success).toBe(true);
    expect(
      UiStoreSnapshotSchema.safeParse({
        ...snapshot,
        voxelBuffer: new Uint8Array(16),
      }).success,
    ).toBe(false);
  });
});
