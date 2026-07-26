import * as z from "zod";

import {
  DirectionUnitSchema,
  FiniteNumberSchema,
  NonNegativeNumberSchema,
  PositiveNumberSchema,
  RotationRadSchema,
  SafeSequenceSchema,
  SchemaVersionSchema,
  TransformSchema,
  UuidSchema,
  Vec3MmSchema,
} from "./primitives";

export const LinearAxisSchema = z
  .strictObject({
    schemaVersion: SchemaVersionSchema,
    id: UuidSchema,
    name: z.string().min(1).max(64),
    kind: z.literal("linear"),
    parentId: UuidSchema.nullable(),
    directionUnit: DirectionUnitSchema,
    pivotMm: Vec3MmSchema,
    minMm: FiniteNumberSchema,
    maxMm: FiniteNumberSchema,
    maxVelocityMmPerMin: PositiveNumberSchema,
    maxAccelerationMmPerS2: PositiveNumberSchema,
    homeMm: FiniteNumberSchema,
  })
  .superRefine((axis, context) => {
    if (axis.minMm >= axis.maxMm) {
      context.addIssue({
        code: "custom",
        path: ["minMm"],
        message: "linear axis minimum must be less than maximum",
      });
    }
    if (axis.homeMm < axis.minMm || axis.homeMm > axis.maxMm) {
      context.addIssue({
        code: "custom",
        path: ["homeMm"],
        message: "linear axis home must be inside the inclusive range",
      });
    }
  });

export const RotaryAxisSchema = z
  .strictObject({
    schemaVersion: SchemaVersionSchema,
    id: UuidSchema,
    name: z.string().min(1).max(64),
    kind: z.literal("rotary"),
    parentId: UuidSchema.nullable(),
    directionUnit: DirectionUnitSchema,
    pivotMm: Vec3MmSchema,
    minRad: FiniteNumberSchema,
    maxRad: FiniteNumberSchema,
    maxVelocityRadPerS: PositiveNumberSchema,
    maxAccelerationRadPerS2: PositiveNumberSchema,
    homeRad: FiniteNumberSchema,
  })
  .superRefine((axis, context) => {
    if (axis.minRad >= axis.maxRad) {
      context.addIssue({
        code: "custom",
        path: ["minRad"],
        message: "rotary axis minimum must be less than maximum",
      });
    }
    if (axis.homeRad < axis.minRad || axis.homeRad > axis.maxRad) {
      context.addIssue({
        code: "custom",
        path: ["homeRad"],
        message: "rotary axis home must be inside the inclusive range",
      });
    }
  });

export const KinematicAxisSchema = z.discriminatedUnion("kind", [
  LinearAxisSchema,
  RotaryAxisSchema,
]);

type KinematicAxisValue = z.infer<typeof KinematicAxisSchema>;

export const SpindleDefinitionSchema = z.strictObject({
  schemaVersion: SchemaVersionSchema,
  id: UuidSchema,
  name: z.string().min(1).max(64),
  maxSpindleSpeedRpm: PositiveNumberSchema,
});

export const WorkEnvelopeSchema = z
  .strictObject({
    minMm: Vec3MmSchema,
    maxMm: Vec3MmSchema,
  })
  .superRefine((envelope, context) => {
    for (const coordinate of ["xMm", "yMm", "zMm"] as const) {
      if (envelope.minMm[coordinate] >= envelope.maxMm[coordinate]) {
        context.addIssue({
          code: "custom",
          path: ["minMm", coordinate],
          message:
            "work envelope minimum must be less than maximum on every axis",
        });
      }
    }
  });

export const CollisionGroupSchema = z.strictObject({
  schemaVersion: SchemaVersionSchema,
  id: UuidSchema,
  name: z.string().min(1).max(64),
  memberResourceIds: z.array(UuidSchema),
});

export const MachineDefinitionSchema = z
  .strictObject({
    schemaVersion: SchemaVersionSchema,
    id: UuidSchema,
    name: z.string().min(1).max(128),
    machineType: z.enum([
      "vertical-machining-center",
      "horizontal-machining-center",
      "lathe",
      "mill-turn",
    ]),
    kinematicRootAxisIds: z.array(UuidSchema).min(1),
    axes: z.array(KinematicAxisSchema).min(1),
    spindles: z.array(SpindleDefinitionSchema).min(1),
    workEnvelope: WorkEnvelopeSchema,
    maxFeedMmPerMin: PositiveNumberSchema,
    modelAssetResourceId: UuidSchema.nullable(),
    collisionGroups: z.array(CollisionGroupSchema),
  })
  .superRefine((machine, context) => {
    const axes = new Map<string, KinematicAxisValue>();
    machine.axes.forEach((axis, axisIndex) => {
      if (axes.has(axis.id)) {
        context.addIssue({
          code: "custom",
          path: ["axes", axisIndex, "id"],
          message: "machine axis IDs must be unique",
        });
      } else {
        axes.set(axis.id, axis);
      }
    });

    const rootIds = new Set<string>();
    machine.kinematicRootAxisIds.forEach((axisId, rootIndex) => {
      if (rootIds.has(axisId)) {
        context.addIssue({
          code: "custom",
          path: ["kinematicRootAxisIds", rootIndex],
          message: "kinematic root axis IDs must be unique",
        });
      }
      rootIds.add(axisId);

      const axis = axes.get(axisId);
      if (!axis) {
        context.addIssue({
          code: "custom",
          path: ["kinematicRootAxisIds", rootIndex],
          message: "kinematic root must reference an axis in the same machine",
        });
      } else if (axis.parentId !== null) {
        context.addIssue({
          code: "custom",
          path: ["kinematicRootAxisIds", rootIndex],
          message: "kinematic root axis must not have a parent",
        });
      }
    });

    machine.axes.forEach((axis, axisIndex) => {
      if (axis.parentId === null) {
        if (!rootIds.has(axis.id)) {
          context.addIssue({
            code: "custom",
            path: ["axes", axisIndex, "id"],
            message:
              "every parentless axis must be listed as a kinematic root",
          });
        }
        return;
      }

      if (!axes.has(axis.parentId)) {
        context.addIssue({
          code: "custom",
          path: ["axes", axisIndex, "parentId"],
          message: "axis parentId must reference an axis in the same machine",
        });
      }
    });

    machine.axes.forEach((startAxis, axisIndex) => {
      const visited = new Set<string>();
      let cursor: KinematicAxisValue | undefined = startAxis;
      while (cursor) {
        if (visited.has(cursor.id)) {
          context.addIssue({
            code: "custom",
            path: ["axes", axisIndex, "parentId"],
            message: "kinematic axis graph must not contain a cycle",
          });
          return;
        }
        visited.add(cursor.id);
        cursor =
          cursor.parentId === null ? undefined : axes.get(cursor.parentId);
      }
    });
  });

export const MaterialProfileSchema = z.strictObject({
  schemaVersion: SchemaVersionSchema,
  id: UuidSchema,
  name: z.string().min(1).max(128),
  materialGroup: z.enum([
    "aluminum",
    "steel",
    "stainless-steel",
    "titanium",
    "brass",
    "plastic",
    "wood",
  ]),
  densityKgPerM3: PositiveNumberSchema,
});

export const SetupSchema = z.strictObject({
  schemaVersion: SchemaVersionSchema,
  id: UuidSchema,
  name: z.string().min(1).max(128),
  workOffsetMm: Vec3MmSchema,
  rotationRad: RotationRadSchema,
  fixtureResourceIds: z.array(UuidSchema),
});

export const CutterGeometrySchema = z
  .strictObject({
    geometryType: z.enum([
      "flat-end-mill",
      "ball-end-mill",
      "bull-nose-end-mill",
      "drill",
      "turning-insert",
    ]),
    diameterMm: PositiveNumberSchema,
    cornerRadiusMm: NonNegativeNumberSchema,
    fluteCount: z.number().int().positive().max(64),
    cuttingLengthMm: PositiveNumberSchema,
    overallLengthMm: PositiveNumberSchema,
  })
  .superRefine((cutter, context) => {
    if (cutter.cornerRadiusMm > cutter.diameterMm / 2) {
      context.addIssue({
        code: "custom",
        path: ["cornerRadiusMm"],
        message: "corner radius must not exceed cutter radius",
      });
    }
    if (cutter.cuttingLengthMm > cutter.overallLengthMm) {
      context.addIssue({
        code: "custom",
        path: ["cuttingLengthMm"],
        message: "cutting length must not exceed overall length",
      });
    }
  });

export const HolderGeometrySchema = z.strictObject({
  diameterMm: PositiveNumberSchema,
  lengthMm: PositiveNumberSchema,
});

export const ToolAssemblySchema = z.strictObject({
  schemaVersion: SchemaVersionSchema,
  id: UuidSchema,
  name: z.string().min(1).max(128),
  toolType: z.enum([
    "milling-cutter",
    "drill",
    "turning-tool",
    "boring-bar",
  ]),
  cutterGeometry: CutterGeometrySchema,
  holderGeometry: HolderGeometrySchema,
  gaugeLengthMm: PositiveNumberSchema,
  stickoutLengthMm: PositiveNumberSchema,
  maxSpindleSpeedRpm: PositiveNumberSchema,
  wearRatio: z.number().min(0).max(1),
  materialCompatibilityIds: z.array(UuidSchema),
});

export const BoxStockGeometrySchema = z.strictObject({
  primitiveType: z.literal("box"),
  sizeMm: z.strictObject({
    xMm: PositiveNumberSchema,
    yMm: PositiveNumberSchema,
    zMm: PositiveNumberSchema,
  }),
});

export const CylinderStockGeometrySchema = z.strictObject({
  primitiveType: z.literal("cylinder"),
  diameterMm: PositiveNumberSchema,
  lengthMm: PositiveNumberSchema,
});

export const StockGeometrySchema = z.discriminatedUnion("primitiveType", [
  BoxStockGeometrySchema,
  CylinderStockGeometrySchema,
]);

export const StockSchema = z.strictObject({
  schemaVersion: SchemaVersionSchema,
  id: UuidSchema,
  name: z.string().min(1).max(128),
  geometry: StockGeometrySchema,
  transform: TransformSchema,
  materialId: UuidSchema,
  representationType: z.enum(["analytic", "mesh", "dexel", "voxel"]),
  resolutionMm: PositiveNumberSchema,
  sourceModelResourceId: UuidSchema.nullable(),
});

export const FeedPerMinuteSchema = z.strictObject({
  mode: z.literal("per-minute"),
  feedMmPerMin: PositiveNumberSchema,
});

export const FeedPerRevolutionSchema = z.strictObject({
  mode: z.literal("per-revolution"),
  feedMmPerRev: PositiveNumberSchema,
});

export const FeedPerToothSchema = z.strictObject({
  mode: z.literal("per-tooth"),
  feedMmPerTooth: PositiveNumberSchema,
});

export const FeedDefinitionSchema = z.discriminatedUnion("mode", [
  FeedPerMinuteSchema,
  FeedPerRevolutionSchema,
  FeedPerToothSchema,
]);

export const OperationSchema = z.strictObject({
  schemaVersion: SchemaVersionSchema,
  id: UuidSchema,
  name: z.string().min(1).max(128),
  operationType: z.enum([
    "milling",
    "drilling",
    "turning",
    "facing",
    "boring",
  ]),
  setupId: UuidSchema,
  toolAssemblyId: UuidSchema,
  strategy: z.string().min(1).max(128),
  feed: FeedDefinitionSchema,
  spindleSpeedRpm: PositiveNumberSchema,
  spindleDirection: z.enum(["clockwise", "counterclockwise"]),
  depthOfCutMm: PositiveNumberSchema,
  widthOfCutMm: PositiveNumberSchema,
  targetGeometryResourceId: UuidSchema.nullable(),
  generatedToolpathId: UuidSchema.nullable(),
});

const SegmentBaseShape = {
  schemaVersion: SchemaVersionSchema,
  id: UuidSchema,
  sequence: SafeSequenceSchema,
};

export const RapidSegmentSchema = z.strictObject({
  ...SegmentBaseShape,
  segmentType: z.literal("rapid"),
  startMm: Vec3MmSchema,
  endMm: Vec3MmSchema,
});

export const LinearSegmentSchema = z.strictObject({
  ...SegmentBaseShape,
  segmentType: z.literal("linear"),
  startMm: Vec3MmSchema,
  endMm: Vec3MmSchema,
  feedMmPerMin: PositiveNumberSchema,
});

export const ArcSegmentSchema = z.strictObject({
  ...SegmentBaseShape,
  segmentType: z.literal("arc"),
  startMm: Vec3MmSchema,
  endMm: Vec3MmSchema,
  centerOffsetMm: Vec3MmSchema,
  plane: z.enum(["xy", "xz", "yz"]),
  clockwise: z.boolean(),
  feedMmPerMin: PositiveNumberSchema,
});

export const DwellSegmentSchema = z.strictObject({
  ...SegmentBaseShape,
  segmentType: z.literal("dwell"),
  positionMm: Vec3MmSchema,
  durationS: PositiveNumberSchema,
});

export const ToolChangeSegmentSchema = z.strictObject({
  ...SegmentBaseShape,
  segmentType: z.literal("tool-change"),
  positionMm: Vec3MmSchema,
  toolAssemblyId: UuidSchema,
});

export const ToolpathSegmentSchema = z.discriminatedUnion("segmentType", [
  RapidSegmentSchema,
  LinearSegmentSchema,
  ArcSegmentSchema,
  DwellSegmentSchema,
  ToolChangeSegmentSchema,
]);

export const SourceLineMapEntrySchema = z.strictObject({
  segmentId: UuidSchema,
  sourceLine: z.number().int().positive(),
});

export const ToolpathIRSchema = z
  .strictObject({
    schemaVersion: SchemaVersionSchema,
    id: UuidSchema,
    operationId: UuidSchema,
    coordinateSystem: z.enum(["machine", "work", "tool"]),
    feedMode: z.enum(["units-per-minute", "units-per-revolution"]),
    spindleMode: z.enum(["rpm", "surface-speed"]),
    segments: z.array(ToolpathSegmentSchema),
    sourceLineMap: z.array(SourceLineMapEntrySchema),
  })
  .superRefine((toolpath, context) => {
    const segmentIds = new Set<string>();
    const sequences = new Set<number>();
    let previousSequence: number | undefined;

    toolpath.segments.forEach((segment, segmentIndex) => {
      if (segmentIds.has(segment.id)) {
        context.addIssue({
          code: "custom",
          path: ["segments", segmentIndex, "id"],
          message: "toolpath segment IDs must be unique",
        });
      }
      segmentIds.add(segment.id);

      if (sequences.has(segment.sequence)) {
        context.addIssue({
          code: "custom",
          path: ["segments", segmentIndex, "sequence"],
          message: "toolpath segment sequences must be unique",
        });
      }
      sequences.add(segment.sequence);

      if (
        previousSequence !== undefined &&
        segment.sequence <= previousSequence
      ) {
        context.addIssue({
          code: "custom",
          path: ["segments", segmentIndex, "sequence"],
          message:
            "toolpath segment sequences must increase in array order",
        });
      }
      previousSequence = segment.sequence;
    });

    const mappedSegmentIds = new Set<string>();
    toolpath.sourceLineMap.forEach((mapping, mappingIndex) => {
      if (!segmentIds.has(mapping.segmentId)) {
        context.addIssue({
          code: "custom",
          path: ["sourceLineMap", mappingIndex, "segmentId"],
          message: "sourceLineMap must reference a segment in the toolpath",
        });
      }
      if (mappedSegmentIds.has(mapping.segmentId)) {
        context.addIssue({
          code: "custom",
          path: ["sourceLineMap", mappingIndex, "segmentId"],
          message: "sourceLineMap must map each segment at most once",
        });
      }
      mappedSegmentIds.add(mapping.segmentId);
    });
  });

export type KinematicAxis = KinematicAxisValue;
export type MachineDefinition = z.infer<typeof MachineDefinitionSchema>;
export type MaterialProfile = z.infer<typeof MaterialProfileSchema>;
export type Setup = z.infer<typeof SetupSchema>;
export type ToolAssembly = z.infer<typeof ToolAssemblySchema>;
export type Stock = z.infer<typeof StockSchema>;
export type Operation = z.infer<typeof OperationSchema>;
export type ToolpathIR = z.infer<typeof ToolpathIRSchema>;
