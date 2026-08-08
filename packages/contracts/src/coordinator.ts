import * as z from "zod";

import { WORKER_PROTOCOL_VERSION } from "./constants";
import {
  NonNegativeNumberSchema,
  PositiveNumberSchema,
  SafeSequenceSchema,
  SchemaVersionSchema,
  UuidSchema,
  Vec3MmSchema,
} from "./primitives";
import { DotCodeSchema } from "./wire-text";

const PlaybackSpeedSchema = z.number().min(0.1).max(100);
const Sha256Schema = z.string().length(64).regex(/^[a-f0-9]{64}$/);
const FixtureIdSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[a-z0-9][a-z0-9._-]*$/);

const MillingStockInputSchema = z.strictObject({
  sizeMm: Vec3MmSchema,
  positionMm: Vec3MmSchema,
  baseResolutionMm: PositiveNumberSchema,
});

const MillingToolInputSchema = z.strictObject({
  diameterMm: PositiveNumberSchema,
  cuttingLengthMm: PositiveNumberSchema,
});

const TurningStockInputSchema = z.strictObject({
  diameterMm: PositiveNumberSchema,
  lengthMm: PositiveNumberSchema,
  positionMm: Vec3MmSchema,
  baseResolutionMm: PositiveNumberSchema,
});

const CollisionBoxSchema = z
  .strictObject({
    objectId: UuidSchema,
    minimumMm: Vec3MmSchema,
    maximumMm: Vec3MmSchema,
  })
  .superRefine((box, context) => {
    for (const axis of ["xMm", "yMm", "zMm"] as const) {
      if (box.minimumMm[axis] >= box.maximumMm[axis]) {
        context.addIssue({
          code: "custom",
          path: ["maximumMm", axis],
          message: "collision box maximum must be greater than minimum",
        });
      }
    }
  });

const MillingProcessConfigurationSchema = z.strictObject({
  processType: z.literal("milling"),
  stock: MillingStockInputSchema,
  tool: MillingToolInputSchema,
  preset: z.enum(["preview", "balanced", "precision"]),
  seed: z.number().int().nonnegative().max(0xffff_ffff),
  brickSizeDexels: z.number().int().positive().max(256),
  rapidRateMmPerMin: PositiveNumberSchema,
  axisLimitMm: PositiveNumberSchema,
  toolCollisionRadiusMm: PositiveNumberSchema,
  collisionBoxes: z.array(CollisionBoxSchema).max(1_024),
});

const TurningProcessConfigurationSchema = z.strictObject({
  processType: z.literal("turning"),
  stock: TurningStockInputSchema,
  toolKind: z.enum(["turning", "drill", "boring"]),
  preset: z.enum(["preview", "balanced", "precision"]),
  seed: z.number().int().nonnegative().max(0xffff_ffff),
  machineMaxSpindleSpeedRpm: PositiveNumberSchema,
  chuckGripLengthMm: NonNegativeNumberSchema,
  rapidRateMmPerMin: PositiveNumberSchema,
  radialSegments: z.number().int().min(8).max(256),
});

export const CoordinatorRunRequestSchema = z.strictObject({
  schemaVersion: SchemaVersionSchema,
  runId: UuidSchema,
  fixtureId: FixtureIdSchema,
  source: z.string().min(1).max(16 * 1024 * 1024),
  initialPositionMm: Vec3MmSchema,
  process: z.discriminatedUnion("processType", [
    MillingProcessConfigurationSchema,
    TurningProcessConfigurationSchema,
  ]),
});

const EnvelopeBaseShape = {
  protocolVersion: z.literal(WORKER_PROTOCOL_VERSION),
  messageId: UuidSchema,
};

export const CoordinatorHandshakeCommandSchema = z.strictObject({
  ...EnvelopeBaseShape,
  replyTo: z.null(),
  kind: z.literal("command"),
  type: z.literal("coordinator.handshake"),
  runId: z.null(),
  sequence: z.literal(0),
  payload: z.strictObject({
    clientVersion: z.string().min(1).max(64),
    supportedProtocolVersions: z.array(z.literal(WORKER_PROTOCOL_VERSION)).min(1),
    transferModes: z.array(z.enum(["transferable", "copy"])).min(1),
  }),
});

export const CoordinatorStartCommandSchema = z
  .strictObject({
    ...EnvelopeBaseShape,
    replyTo: z.null(),
    kind: z.literal("command"),
    type: z.literal("simulation.start"),
    runId: UuidSchema,
    sequence: SafeSequenceSchema,
    payload: z.strictObject({
      executionMode: z.enum(["realtime", "fast-forward"]),
      playbackSpeed: PlaybackSpeedSchema,
      run: CoordinatorRunRequestSchema,
    }),
  })
  .superRefine((command, context) => {
    if (command.runId !== command.payload.run.runId) {
      context.addIssue({
        code: "custom",
        path: ["payload", "run", "runId"],
        message: "run request and command envelope must use the same runId",
      });
    }
  });

export const CoordinatorPauseCommandSchema = z.strictObject({
  ...EnvelopeBaseShape,
  replyTo: z.null(),
  kind: z.literal("command"),
  type: z.literal("simulation.pause"),
  runId: UuidSchema,
  sequence: SafeSequenceSchema,
  payload: z.strictObject({}),
});

export const CoordinatorResumeCommandSchema = z.strictObject({
  ...EnvelopeBaseShape,
  replyTo: z.null(),
  kind: z.literal("command"),
  type: z.literal("simulation.resume"),
  runId: UuidSchema,
  sequence: SafeSequenceSchema,
  payload: z.strictObject({ playbackSpeed: PlaybackSpeedSchema }),
});

export const CoordinatorCancelCommandSchema = z.strictObject({
  ...EnvelopeBaseShape,
  replyTo: z.null(),
  kind: z.literal("command"),
  type: z.literal("simulation.cancel"),
  runId: UuidSchema,
  sequence: SafeSequenceSchema,
  payload: z.strictObject({
    reason: z.enum(["user", "replaced", "collision", "shutdown"]),
  }),
});

export const CoordinatorSnapshotCommandSchema = z.strictObject({
  ...EnvelopeBaseShape,
  replyTo: z.null(),
  kind: z.literal("command"),
  type: z.literal("simulation.snapshot"),
  runId: UuidSchema,
  sequence: SafeSequenceSchema,
  payload: z.strictObject({}),
});

export const CoordinatorDisposeCommandSchema = z.strictObject({
  ...EnvelopeBaseShape,
  replyTo: z.null(),
  kind: z.literal("command"),
  type: z.literal("run.dispose"),
  runId: UuidSchema,
  sequence: SafeSequenceSchema,
  payload: z.strictObject({
    reason: z.enum(["completed", "cancelled", "replaced", "shutdown"]),
  }),
});

export const CoordinatorCommandSchema = z.discriminatedUnion("type", [
  CoordinatorHandshakeCommandSchema,
  CoordinatorStartCommandSchema,
  CoordinatorPauseCommandSchema,
  CoordinatorResumeCommandSchema,
  CoordinatorCancelCommandSchema,
  CoordinatorSnapshotCommandSchema,
  CoordinatorDisposeCommandSchema,
]);

const BinarySliceSchema = z.strictObject({
  handleId: UuidSchema,
  binaryKind: z.enum([
    "milling.top-z-mm",
    "milling.cell-indices",
    "turning.inner-radius-mm",
    "turning.outer-radius-mm",
    "turning.cell-indices",
  ]),
  byteOffset: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  byteLength: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  elementType: z.enum(["uint32", "float32"]),
  ownership: z.literal("receiver"),
  transferMode: z.enum(["transferable", "copy"]),
});

const CollisionRecordSchema = z.strictObject({
  code: DotCodeSchema,
  objectAId: UuidSchema,
  objectBId: UuidSchema,
  positionMm: Vec3MmSchema,
  penetrationEstimateMm: PositiveNumberSchema,
  sourceLine: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
});

const CoreSummarySchema = z.strictObject({
  schemaVersion: SchemaVersionSchema,
  coreVersion: z.string().min(1).max(64),
  wasm: z.literal(true),
  phase: z.enum([
    "initialized",
    "progress",
    "snapshot",
    "completed",
    "stopped",
    "cancelled",
  ]),
  runId: UuidSchema,
  fixtureId: FixtureIdSchema,
  processType: z.enum(["milling", "turning"]),
  toolpathId: UuidSchema,
  parseSemanticHashSha256: Sha256Schema,
  stateSemanticHashSha256: Sha256Schema,
  finalSemanticHashSha256: Sha256Schema.nullable(),
  stockHashSha256: Sha256Schema,
  currentStep: SafeSequenceSchema,
  totalSteps: SafeSequenceSchema,
  logicalTimeS: NonNegativeNumberSchema,
  toolPositionMm: Vec3MmSchema,
  stockRevision: SafeSequenceSchema,
  removedVolumeMm3: NonNegativeNumberSchema,
  diagnosticCodes: z.array(DotCodeSchema),
  collision: CollisionRecordSchema.nullable(),
  completed: z.boolean(),
  stopped: z.boolean(),
  render: z.record(z.string(), z.unknown()).nullable(),
  binaryLayout: z.array(z.record(z.string(), z.unknown())),
  binaryByteLength: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
}).superRefine((summary, context) => {
  if (summary.completed && summary.stopped) {
    context.addIssue({
      code: "custom",
      path: ["completed"],
      message: "completed and stopped are mutually exclusive",
    });
  }
  if (summary.phase === "completed" && !summary.completed) {
    context.addIssue({
      code: "custom",
      path: ["completed"],
      message: "completed phase requires completed=true",
    });
  }
  if (summary.phase === "stopped" && !summary.stopped) {
    context.addIssue({
      code: "custom",
      path: ["stopped"],
      message: "stopped phase requires stopped=true",
    });
  }
});

export const CoordinatorReadyEventSchema = z.strictObject({
  ...EnvelopeBaseShape,
  replyTo: UuidSchema,
  kind: z.literal("event"),
  type: z.literal("coordinator.ready"),
  runId: z.null(),
  sequence: z.literal(0),
  payload: z.strictObject({
    coreVersion: z.string().min(1).max(64),
    selectedProtocolVersion: z.literal(WORKER_PROTOCOL_VERSION),
    transferMode: z.enum(["transferable", "copy"]),
    wasm: z.literal(true),
  }),
});

export const CoordinatorUpdateEventSchema = z.strictObject({
  ...EnvelopeBaseShape,
  replyTo: UuidSchema.nullable(),
  kind: z.literal("event"),
  type: z.literal("simulation.update"),
  runId: UuidSchema,
  sequence: SafeSequenceSchema,
  payload: z.strictObject({
    summary: CoreSummarySchema,
    binarySlices: z.array(BinarySliceSchema),
  }),
});

export const CoordinatorDisposedEventSchema = z.strictObject({
  ...EnvelopeBaseShape,
  replyTo: UuidSchema.nullable(),
  kind: z.literal("event"),
  type: z.literal("run.disposed"),
  runId: UuidSchema,
  sequence: SafeSequenceSchema,
  payload: z.strictObject({ reason: z.string().min(1).max(64) }),
});

export const CoordinatorErrorEventSchema = z.strictObject({
  ...EnvelopeBaseShape,
  replyTo: UuidSchema.nullable(),
  kind: z.literal("event"),
  type: z.literal("coordinator.error"),
  runId: UuidSchema.nullable(),
  sequence: SafeSequenceSchema,
  payload: z.strictObject({
    code: DotCodeSchema,
    message: z.string().min(1).max(1_024),
    recoverable: z.boolean(),
  }),
});

export const CoordinatorEventSchema = z.discriminatedUnion("type", [
  CoordinatorReadyEventSchema,
  CoordinatorUpdateEventSchema,
  CoordinatorDisposedEventSchema,
  CoordinatorErrorEventSchema,
]);

export type CoordinatorRunRequest = z.infer<typeof CoordinatorRunRequestSchema>;
export type CoordinatorCommand = z.infer<typeof CoordinatorCommandSchema>;
export type CoordinatorEvent = z.infer<typeof CoordinatorEventSchema>;
export type CoordinatorCoreSummary = z.infer<typeof CoreSummarySchema>;
export type CoordinatorBinarySlice = z.infer<typeof BinarySliceSchema>;

export interface CoordinatorTransportPacket<TMessage = CoordinatorEvent> {
  readonly message: TMessage;
  readonly binary: ArrayBuffer | null;
}
