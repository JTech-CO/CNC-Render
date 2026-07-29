import * as z from "zod";

import { PROJECT_SCHEMA_ID, SCHEMA_VERSION } from "./constants";
import {
  MachineDefinitionSchema,
  MaterialProfileSchema,
  OperationSchema,
  SetupSchema,
  StockSchema,
  ToolAssemblySchema,
  ToolpathIRSchema,
} from "./domain";
import {
  ResourceDescriptorSchema,
  SafeSequenceSchema,
  SchemaVersionSchema,
  UtcDateTimeSchema,
  UuidSchema,
  isSafeResourcePath,
} from "./primitives";

export const ProjectSettingsSchema = z.strictObject({
  schemaVersion: SchemaVersionSchema,
  accuracyPreset: z.enum(["preview", "balanced", "precision"]),
  displayDecimalPlaces: z.number().int().min(0).max(9),
  deterministicSeed: SafeSequenceSchema,
});

const ProjectWireSchema = z
  .strictObject({
    $schema: z.literal(PROJECT_SCHEMA_ID),
    schemaVersion: SchemaVersionSchema,
    id: UuidSchema,
    name: z.string().min(1).max(200),
    createdAt: UtcDateTimeSchema,
    updatedAt: UtcDateTimeSchema,
    unitSystem: z.enum(["metric", "imperial"]),
    machineId: UuidSchema,
    stockId: UuidSchema,
    operationIds: z.array(UuidSchema),
    machines: z.array(MachineDefinitionSchema).min(1),
    materials: z.array(MaterialProfileSchema).min(1),
    setups: z.array(SetupSchema).min(1),
    toolAssemblies: z.array(ToolAssemblySchema).min(1),
    stocks: z.array(StockSchema).min(1),
    operations: z.array(OperationSchema),
    toolpaths: z.array(ToolpathIRSchema),
    resources: z.array(ResourceDescriptorSchema),
    settings: ProjectSettingsSchema,
  })
  .meta({
    $id: PROJECT_SCHEMA_ID,
    title: "CNC Render Project",
    description: "Version 1 CNC Render project root document",
  });

type ProjectWire = z.infer<typeof ProjectWireSchema>;

function addIssue(
  context: z.RefinementCtx<ProjectWire>,
  path: PropertyKey[],
  message: string,
) {
  context.addIssue({
    code: "custom",
    path,
    message,
  });
}

function indexIds<T extends { id: string }>(
  values: readonly T[],
  collectionName: string,
  context: z.RefinementCtx<ProjectWire>,
): Map<string, T> {
  const indexed = new Map<string, T>();
  values.forEach((value, index) => {
    if (indexed.has(value.id)) {
      addIssue(
        context,
        [collectionName, index, "id"],
        `duplicate ${collectionName} id`,
      );
    } else {
      indexed.set(value.id, value);
    }
  });
  return indexed;
}

function validateFiniteAndNegativeZero(
  value: unknown,
  path: PropertyKey[],
  context: z.RefinementCtx<ProjectWire>,
) {
  if (typeof value === "number") {
    if (!Number.isFinite(value) || Object.is(value, -0)) {
      addIssue(
        context,
        path,
        "wire numbers must be finite and must not be negative zero",
      );
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      validateFiniteAndNegativeZero(item, [...path, index], context),
    );
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      validateFiniteAndNegativeZero(item, [...path, key], context);
    }
  }
}

function validateGlobalEntityIds(
  project: ProjectWire,
  context: z.RefinementCtx<ProjectWire>,
) {
  const entityIds = new Map<string, PropertyKey[]>();

  const register = (id: string, path: PropertyKey[]) => {
    const firstPath = entityIds.get(id);
    if (firstPath) {
      addIssue(
        context,
        path,
        `persisted entity IDs must be globally unique; first used at ${firstPath.join(".")}`,
      );
    } else {
      entityIds.set(id, path);
    }
  };

  register(project.id, ["id"]);
  project.resources.forEach((resource, resourceIndex) =>
    register(resource.id, ["resources", resourceIndex, "id"]),
  );
  project.machines.forEach((machine, machineIndex) => {
    register(machine.id, ["machines", machineIndex, "id"]);
    machine.axes.forEach((axis, axisIndex) =>
      register(axis.id, ["machines", machineIndex, "axes", axisIndex, "id"]),
    );
    machine.spindles.forEach((spindle, spindleIndex) =>
      register(spindle.id, [
        "machines",
        machineIndex,
        "spindles",
        spindleIndex,
        "id",
      ]),
    );
    machine.collisionGroups.forEach((group, groupIndex) =>
      register(group.id, [
        "machines",
        machineIndex,
        "collisionGroups",
        groupIndex,
        "id",
      ]),
    );
  });
  project.materials.forEach((material, materialIndex) =>
    register(material.id, ["materials", materialIndex, "id"]),
  );
  project.setups.forEach((setup, setupIndex) =>
    register(setup.id, ["setups", setupIndex, "id"]),
  );
  project.toolAssemblies.forEach((tool, toolIndex) =>
    register(tool.id, ["toolAssemblies", toolIndex, "id"]),
  );
  project.stocks.forEach((stock, stockIndex) =>
    register(stock.id, ["stocks", stockIndex, "id"]),
  );
  project.operations.forEach((operation, operationIndex) =>
    register(operation.id, ["operations", operationIndex, "id"]),
  );
  project.toolpaths.forEach((toolpath, toolpathIndex) => {
    register(toolpath.id, ["toolpaths", toolpathIndex, "id"]);
    toolpath.segments.forEach((segment, segmentIndex) =>
      register(segment.id, [
        "toolpaths",
        toolpathIndex,
        "segments",
        segmentIndex,
        "id",
      ]),
    );
  });
}

function utcOrderingKey(timestamp: string): string | undefined {
  const match =
    /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,9}))?Z$/.exec(
      timestamp,
    );
  if (!match) {
    return undefined;
  }
  return `${match[1]}.${(match[2] ?? "").padEnd(9, "0")}`;
}

function validateProjectReferences(
  project: ProjectWire,
  context: z.RefinementCtx<ProjectWire>,
) {
  validateFiniteAndNegativeZero(project, [], context);
  validateGlobalEntityIds(project, context);

  const createdAt = utcOrderingKey(project.createdAt);
  const updatedAt = utcOrderingKey(project.updatedAt);
  if (createdAt !== undefined && updatedAt !== undefined && createdAt > updatedAt) {
    addIssue(
      context,
      ["updatedAt"],
      "updatedAt must not be earlier than createdAt",
    );
  }

  const resources = indexIds(project.resources, "resources", context);
  const machines = indexIds(project.machines, "machines", context);
  const materials = indexIds(project.materials, "materials", context);
  const setups = indexIds(project.setups, "setups", context);
  const tools = indexIds(project.toolAssemblies, "toolAssemblies", context);
  const stocks = indexIds(project.stocks, "stocks", context);
  const operations = indexIds(project.operations, "operations", context);
  const toolpaths = indexIds(project.toolpaths, "toolpaths", context);

  if (!machines.has(project.machineId)) {
    addIssue(context, ["machineId"], "machineId must reference machines");
  }
  if (!stocks.has(project.stockId)) {
    addIssue(context, ["stockId"], "stockId must reference stocks");
  }

  const operationIdSet = new Set<string>();
  project.operationIds.forEach((operationId, index) => {
    if (operationIdSet.has(operationId)) {
      addIssue(
        context,
        ["operationIds", index],
        "operationIds must be unique",
      );
    }
    operationIdSet.add(operationId);
    if (!operations.has(operationId)) {
      addIssue(
        context,
        ["operationIds", index],
        "operationIds must reference operations",
      );
    }
  });

  project.machines.forEach((machine, machineIndex) => {
    if (
      machine.modelAssetResourceId !== null &&
      !resources.has(machine.modelAssetResourceId)
    ) {
      addIssue(
        context,
        ["machines", machineIndex, "modelAssetResourceId"],
        "machine model asset must reference resources",
      );
    }
    machine.collisionGroups.forEach((group, groupIndex) => {
      group.memberResourceIds.forEach((resourceId, memberIndex) => {
        if (!resources.has(resourceId)) {
          addIssue(
            context,
            [
              "machines",
              machineIndex,
              "collisionGroups",
              groupIndex,
              "memberResourceIds",
              memberIndex,
            ],
            "collision group members must reference resources",
          );
        }
      });
    });
  });

  project.toolAssemblies.forEach((tool, index) => {
    for (const materialId of tool.materialCompatibilityIds) {
      if (!materials.has(materialId)) {
        addIssue(
          context,
          ["toolAssemblies", index, "materialCompatibilityIds"],
          "material compatibility must reference materials",
        );
      }
    }
  });

  project.setups.forEach((setup, index) => {
    setup.fixtureResourceIds.forEach((resourceId) => {
      if (!resources.has(resourceId)) {
        addIssue(
          context,
          ["setups", index, "fixtureResourceIds"],
          "fixture resource must reference resources",
        );
      }
    });
  });

  project.stocks.forEach((stock, index) => {
    if (!materials.has(stock.materialId)) {
      addIssue(
        context,
        ["stocks", index, "materialId"],
        "stock materialId must reference materials",
      );
    }
    if (
      stock.sourceModelResourceId !== null &&
      !resources.has(stock.sourceModelResourceId)
    ) {
      addIssue(
        context,
        ["stocks", index, "sourceModelResourceId"],
        "stock source model must reference resources",
      );
    }
  });

  project.operations.forEach((operation, index) => {
    if (!setups.has(operation.setupId)) {
      addIssue(
        context,
        ["operations", index, "setupId"],
        "operation setupId must reference setups",
      );
    }
    if (!tools.has(operation.toolAssemblyId)) {
      addIssue(
        context,
        ["operations", index, "toolAssemblyId"],
        "operation toolAssemblyId must reference toolAssemblies",
      );
    }
    if (
      operation.targetGeometryResourceId !== null &&
      !resources.has(operation.targetGeometryResourceId)
    ) {
      addIssue(
        context,
        ["operations", index, "targetGeometryResourceId"],
        "target geometry must reference resources",
      );
    }
    if (
      operation.generatedToolpathId !== null &&
      !toolpaths.has(operation.generatedToolpathId)
    ) {
      addIssue(
        context,
        ["operations", index, "generatedToolpathId"],
        "generated toolpath must reference toolpaths",
      );
    }
  });

  project.toolpaths.forEach((toolpath, toolpathIndex) => {
    if (!operations.has(toolpath.operationId)) {
      addIssue(
        context,
        ["toolpaths", toolpathIndex, "operationId"],
        "toolpath operationId must reference operations",
      );
    }
    toolpath.segments.forEach((segment, segmentIndex) => {
      if (
        segment.segmentType === "tool-change" &&
        !tools.has(segment.toolAssemblyId)
      ) {
        addIssue(
          context,
          [
            "toolpaths",
            toolpathIndex,
            "segments",
            segmentIndex,
            "toolAssemblyId",
          ],
          "tool-change segment must reference toolAssemblies",
        );
      }
    });
  });

  const normalizedPaths = new Map<string, number>();
  project.resources.forEach((resource, index) => {
    if (!isSafeResourcePath(resource.path)) {
      addIssue(
        context,
        ["resources", index, "path"],
        "resource path must be a safe normalized relative path",
      );
    }
    const normalized = resource.path.normalize("NFC").toLocaleLowerCase("en-US");
    if (normalizedPaths.has(normalized)) {
      addIssue(
        context,
        ["resources", index, "path"],
        "resource paths must not collide after normalization",
      );
    } else {
      normalizedPaths.set(normalized, index);
    }
    if (
      ["checkpoint", "preview", "report"].includes(resource.role) &&
      resource.authoritative
    ) {
      addIssue(
        context,
        ["resources", index, "authoritative"],
        "derived checkpoint, preview, and report resources are not authoritative",
      );
    }
  });
}

export const ProjectSchema = ProjectWireSchema.superRefine(
  validateProjectReferences,
);

export type Project = z.infer<typeof ProjectSchema>;

export function parseProject(input: unknown): Project {
  return ProjectSchema.parse(input);
}

export function projectJsonSchema(): z.core.JSONSchema.JSONSchema {
  return z.toJSONSchema(ProjectWireSchema, {
    target: "draft-2020-12",
    io: "input",
    unrepresentable: "throw",
    cycles: "throw",
    reused: "inline",
  });
}

export const CURRENT_PROJECT_SCHEMA_VERSION = SCHEMA_VERSION;
