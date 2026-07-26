import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  CutterGeometrySchema,
  LinearAxisSchema,
  MachineDefinitionSchema,
  ProjectSchema,
  RotaryAxisSchema,
  ToolpathIRSchema,
  WorkEnvelopeSchema,
} from "@cnc-render/contracts";

type JsonObject = Record<string, unknown>;
type JsonPath = Array<string | number>;
type ContractParseResult =
  | { success: true }
  | {
      success: false;
      error: { issues: ReadonlyArray<{ message: string }> };
    };

const validProject = JSON.parse(
  readFileSync(
    new URL("../fixtures/m1/valid-project.json", import.meta.url),
    "utf8",
  ),
) as JsonObject;

const secondAxisId = "40000000-0000-4000-8000-000000000001";
const collisionGroupId = "40000000-0000-4000-8000-000000000002";
const secondSegmentId = "40000000-0000-4000-8000-000000000003";
const missingEntityId = "40000000-0000-4000-8000-000000000099";

function valueAt(root: unknown, path: JsonPath): unknown {
  let cursor = root;
  for (const segment of path) {
    if (typeof segment === "number") {
      if (!Array.isArray(cursor)) {
        throw new TypeError(`expected array at ${path.join(".")}`);
      }
      cursor = cursor[segment];
      continue;
    }
    if (cursor === null || typeof cursor !== "object" || Array.isArray(cursor)) {
      throw new TypeError(`expected object at ${path.join(".")}`);
    }
    cursor = (cursor as JsonObject)[segment];
  }
  return cursor;
}

function objectAt(root: unknown, path: JsonPath): JsonObject {
  const value = valueAt(root, path);
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`expected object at ${path.join(".")}`);
  }
  return value as JsonObject;
}

function arrayAt(root: unknown, path: JsonPath): unknown[] {
  const value = valueAt(root, path);
  if (!Array.isArray(value)) {
    throw new TypeError(`expected array at ${path.join(".")}`);
  }
  return value;
}

function projectFixture(): JsonObject {
  return structuredClone(validProject);
}

function machineFixture(): JsonObject {
  return structuredClone(objectAt(validProject, ["machines", 0]));
}

function linearAxisFixture(): JsonObject {
  return structuredClone(
    objectAt(validProject, ["machines", 0, "axes", 0]),
  );
}

function toolpathFixture(): JsonObject {
  return structuredClone(objectAt(validProject, ["toolpaths", 0]));
}

function expectRejectedWith(
  result: ContractParseResult,
  expectedMessage: RegExp,
) {
  expect(result.success).toBe(false);
  if (!result.success) {
    expect(result.error.issues.map((issue) => issue.message).join("\n")).toMatch(
      expectedMessage,
    );
  }
}

function secondLinearAxis(parentId: string | null): JsonObject {
  const axis = linearAxisFixture();
  axis.id = secondAxisId;
  axis.name = "Y";
  axis.parentId = parentId;
  axis.directionUnit = { x: 0, y: 1, z: 0 };
  return axis;
}

function secondLinearSegment(sequence: number): JsonObject {
  const segment = structuredClone(
    objectAt(validProject, ["toolpaths", 0, "segments", 0]),
  );
  segment.id = secondSegmentId;
  segment.sequence = sequence;
  return segment;
}

describe("schema M1 local domain semantics", () => {
  it("schema rejects reversed and out-of-home linear or rotary axes directly", () => {
    const reversedLinear = linearAxisFixture();
    reversedLinear.minMm = 500;
    expectRejectedWith(
      LinearAxisSchema.safeParse(reversedLinear),
      /minimum must be less/,
    );

    const outOfRangeLinear = linearAxisFixture();
    outOfRangeLinear.homeMm = 501;
    expectRejectedWith(
      LinearAxisSchema.safeParse(outOfRangeLinear),
      /home must be inside/,
    );

    const rotaryAxis = {
      schemaVersion: 1,
      id: secondAxisId,
      name: "A",
      kind: "rotary",
      parentId: null,
      directionUnit: { x: 1, y: 0, z: 0 },
      pivotMm: { xMm: 0, yMm: 0, zMm: 0 },
      minRad: -Math.PI,
      maxRad: Math.PI,
      maxVelocityRadPerS: 2,
      maxAccelerationRadPerS2: 4,
      homeRad: 0,
    };
    expect(RotaryAxisSchema.safeParse(rotaryAxis).success).toBe(true);
    expectRejectedWith(
      RotaryAxisSchema.safeParse({
        ...rotaryAxis,
        minRad: Math.PI,
      }),
      /minimum must be less/,
    );
    expectRejectedWith(
      RotaryAxisSchema.safeParse({
        ...rotaryAxis,
        homeRad: Math.PI * 2,
      }),
      /home must be inside/,
    );
  });

  it("schema enforces work-envelope and cutter local invariants directly", () => {
    expectRejectedWith(
      WorkEnvelopeSchema.safeParse({
        minMm: { xMm: 1, yMm: 0, zMm: 0 },
        maxMm: { xMm: 1, yMm: 10, zMm: 10 },
      }),
      /work envelope minimum/,
    );

    const cutter = structuredClone(
      objectAt(validProject, [
        "toolAssemblies",
        0,
        "cutterGeometry",
      ]),
    );
    expect(CutterGeometrySchema.safeParse(cutter).success).toBe(true);
    expectRejectedWith(
      CutterGeometrySchema.safeParse({
        ...cutter,
        cornerRadiusMm: 6,
      }),
      /corner radius/,
    );
    expectRejectedWith(
      CutterGeometrySchema.safeParse({
        ...cutter,
        cuttingLengthMm: 100,
      }),
      /cutting length/,
    );
  });

  it("schema validates machine axis identity, parents, roots, and cycles locally", () => {
    expect(MachineDefinitionSchema.safeParse(machineFixture()).success).toBe(
      true,
    );

    const duplicateAxis = machineFixture();
    arrayAt(duplicateAxis, ["axes"]).push(linearAxisFixture());
    expectRejectedWith(
      MachineDefinitionSchema.safeParse(duplicateAxis),
      /axis IDs must be unique/,
    );

    const duplicateRoot = machineFixture();
    const rootId = arrayAt(duplicateRoot, ["kinematicRootAxisIds"])[0];
    arrayAt(duplicateRoot, ["kinematicRootAxisIds"]).push(rootId);
    expectRejectedWith(
      MachineDefinitionSchema.safeParse(duplicateRoot),
      /root axis IDs must be unique/,
    );

    const omittedRoot = machineFixture();
    arrayAt(omittedRoot, ["axes"]).push(secondLinearAxis(null));
    expectRejectedWith(
      MachineDefinitionSchema.safeParse(omittedRoot),
      /every parentless axis/,
    );

    const missingParent = machineFixture();
    arrayAt(missingParent, ["axes"]).push(secondLinearAxis(missingEntityId));
    expectRejectedWith(
      MachineDefinitionSchema.safeParse(missingParent),
      /parentId must reference/,
    );

    const cyclic = machineFixture();
    const firstAxis = objectAt(cyclic, ["axes", 0]);
    const firstAxisId = firstAxis.id as string;
    firstAxis.parentId = secondAxisId;
    arrayAt(cyclic, ["axes"]).push(secondLinearAxis(firstAxisId));
    expectRejectedWith(
      MachineDefinitionSchema.safeParse(cyclic),
      /must not contain a cycle/,
    );
  });

  it("schema validates toolpath segment identity, sequence, and source maps locally", () => {
    expect(ToolpathIRSchema.safeParse(toolpathFixture()).success).toBe(true);

    const duplicateId = toolpathFixture();
    const duplicateSegment = secondLinearSegment(1);
    duplicateSegment.id = objectAt(duplicateId, ["segments", 0]).id;
    arrayAt(duplicateId, ["segments"]).push(duplicateSegment);
    expectRejectedWith(
      ToolpathIRSchema.safeParse(duplicateId),
      /segment IDs must be unique/,
    );

    const regressingSequence = toolpathFixture();
    objectAt(regressingSequence, ["segments", 0]).sequence = 2;
    arrayAt(regressingSequence, ["segments"]).push(secondLinearSegment(1));
    expectRejectedWith(
      ToolpathIRSchema.safeParse(regressingSequence),
      /sequences must increase/,
    );

    const danglingSourceMap = toolpathFixture();
    objectAt(danglingSourceMap, ["sourceLineMap", 0]).segmentId =
      missingEntityId;
    expectRejectedWith(
      ToolpathIRSchema.safeParse(danglingSourceMap),
      /must reference a segment/,
    );

    const duplicateSourceMap = toolpathFixture();
    arrayAt(duplicateSourceMap, ["sourceLineMap"]).push(
      structuredClone(objectAt(duplicateSourceMap, ["sourceLineMap", 0])),
    );
    expectRejectedWith(
      ToolpathIRSchema.safeParse(duplicateSourceMap),
      /map each segment at most once/,
    );
  });
});

describe("schema M1 project-wide semantics", () => {
  it("schema rejects dangling collision-group and tool-change references", () => {
    const collisionProject = projectFixture();
    arrayAt(collisionProject, ["machines", 0, "collisionGroups"]).push({
      schemaVersion: 1,
      id: collisionGroupId,
      name: "Missing model",
      memberResourceIds: [missingEntityId],
    });
    expectRejectedWith(
      ProjectSchema.safeParse(collisionProject),
      /collision group members must reference resources/,
    );

    const toolChangeProject = projectFixture();
    arrayAt(toolChangeProject, ["toolpaths", 0, "segments"]).push({
      schemaVersion: 1,
      id: secondSegmentId,
      sequence: 1,
      segmentType: "tool-change",
      positionMm: { xMm: 0, yMm: 0, zMm: 40 },
      toolAssemblyId: missingEntityId,
    });
    expectRejectedWith(
      ProjectSchema.safeParse(toolChangeProject),
      /tool-change segment must reference toolAssemblies/,
    );
  });

  it("schema rejects globally duplicated persisted entity IDs", () => {
    const project = projectFixture();
    const spindleId = objectAt(project, ["machines", 0, "spindles", 0])
      .id as string;
    arrayAt(project, ["machines", 0, "collisionGroups"]).push({
      schemaVersion: 1,
      id: spindleId,
      name: "Duplicate spindle ID",
      memberResourceIds: [],
    });

    expectRejectedWith(
      ProjectSchema.safeParse(project),
      /persisted entity IDs must be globally unique/,
    );
  });

  it("schema rejects updatedAt earlier than createdAt at nanosecond precision", () => {
    const project = projectFixture();
    project.createdAt = "2026-07-26T00:00:00.000000002Z";
    project.updatedAt = "2026-07-26T00:00:00.000000001Z";

    expectRejectedWith(
      ProjectSchema.safeParse(project),
      /updatedAt must not be earlier/,
    );
  });
});
