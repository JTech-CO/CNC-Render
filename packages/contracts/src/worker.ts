import * as z from "zod";

import {
  WORKER_PROTOCOL_VERSION,
  WORKER_SCHEMA_ID,
} from "./constants";
import { SimulationEventSchema } from "./events";
import { ProjectSchema } from "./project";
import {
  SafeSequenceSchema,
  UuidSchema,
} from "./primitives";
import { DotCodeSchema } from "./wire-text";

export const TransferModeSchema = z.enum([
  "transferable",
  "shared-array-buffer",
  "copy",
]);

export const BinaryHandleDescriptorSchema = z.strictObject({
  handleId: UuidSchema,
  binaryKind: z.enum([
    "toolpath-segments",
    "stock-field",
    "render-mesh",
    "checkpoint",
  ]),
  byteLength: z
    .number()
    .int()
    .positive()
    .max(Number.MAX_SAFE_INTEGER),
  elementType: z.enum([
    "uint8",
    "uint16",
    "uint32",
    "int32",
    "float32",
    "float64",
  ]),
  ownership: z.enum(["sender", "receiver", "shared", "copy"]),
});

const EnvelopeBaseShape = {
  protocolVersion: z.literal(WORKER_PROTOCOL_VERSION),
  messageId: UuidSchema,
};

export const WorkerHandshakeCommandSchema = z.strictObject({
  ...EnvelopeBaseShape,
  replyTo: z.null(),
  kind: z.literal("command"),
  type: z.literal("worker.handshake"),
  runId: z.null(),
  sequence: z.literal(0),
  payload: z.strictObject({
    supportedProtocolVersions: z
      .array(z.number().int().positive().max(Number.MAX_SAFE_INTEGER))
      .min(1),
    clientVersion: z.string().min(1).max(64),
    transferModes: z.array(TransferModeSchema).min(1),
  }),
});

export const ProjectLoadCommandSchema = z.strictObject({
  ...EnvelopeBaseShape,
  replyTo: z.null(),
  kind: z.literal("command"),
  type: z.literal("project.load"),
  runId: UuidSchema,
  sequence: SafeSequenceSchema,
  payload: z.strictObject({
    project: ProjectSchema,
    transferMode: TransferModeSchema,
    binaryHandles: z.array(BinaryHandleDescriptorSchema),
  }),
});

export const RunDisposeCommandSchema = z.strictObject({
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

export const WorkerReadyEventSchema = z.strictObject({
  ...EnvelopeBaseShape,
  replyTo: UuidSchema,
  kind: z.literal("event"),
  type: z.literal("worker.ready"),
  runId: z.null(),
  sequence: z.literal(0),
  payload: z.strictObject({
    selectedProtocolVersion: z.literal(WORKER_PROTOCOL_VERSION),
    coreVersion: z.string().min(1).max(64),
    transferMode: TransferModeSchema,
  }),
});

export const ProjectAcceptedEventSchema = z.strictObject({
  ...EnvelopeBaseShape,
  replyTo: UuidSchema,
  kind: z.literal("event"),
  type: z.literal("project.accepted"),
  runId: UuidSchema,
  sequence: SafeSequenceSchema,
  payload: z.strictObject({
    projectId: UuidSchema,
    semanticHashSha256: z.string().length(64).regex(/^[a-f0-9]{64}$/),
  }),
});

export const ProjectRejectedEventSchema = z.strictObject({
  ...EnvelopeBaseShape,
  replyTo: UuidSchema,
  kind: z.literal("event"),
  type: z.literal("project.rejected"),
  runId: UuidSchema,
  sequence: SafeSequenceSchema,
  payload: z.strictObject({
    code: DotCodeSchema,
    messageKey: DotCodeSchema,
    path: z.array(z.union([z.string(), z.number().int().nonnegative()])),
  }),
});

export const SimulationEventMessageSchema = z
  .strictObject({
    ...EnvelopeBaseShape,
    replyTo: UuidSchema.nullable(),
    kind: z.literal("event"),
    type: z.literal("simulation.event"),
    runId: UuidSchema,
    sequence: SafeSequenceSchema,
    payload: z.strictObject({
      event: SimulationEventSchema,
      binaryHandles: z.array(BinaryHandleDescriptorSchema),
    }),
  })
  .superRefine((message, context) => {
    if (message.runId !== message.payload.event.runId) {
      context.addIssue({
        code: "custom",
        path: ["payload", "event", "runId"],
        message: "simulation event runId must match the envelope runId",
      });
    }
    if (message.sequence !== message.payload.event.sequence) {
      context.addIssue({
        code: "custom",
        path: ["payload", "event", "sequence"],
        message: "simulation event sequence must match the envelope sequence",
      });
    }
  });

export const WorkerErrorEventSchema = z.strictObject({
  ...EnvelopeBaseShape,
  replyTo: UuidSchema.nullable(),
  kind: z.literal("event"),
  type: z.literal("worker.error"),
  runId: UuidSchema.nullable(),
  sequence: SafeSequenceSchema,
  payload: z.strictObject({
    code: DotCodeSchema,
    messageKey: DotCodeSchema,
    recoverable: z.boolean(),
  }),
});

export const WorkerMessageSchema = z
  .discriminatedUnion("type", [
    WorkerHandshakeCommandSchema,
    ProjectLoadCommandSchema,
    RunDisposeCommandSchema,
    WorkerReadyEventSchema,
    ProjectAcceptedEventSchema,
    ProjectRejectedEventSchema,
    SimulationEventMessageSchema,
    WorkerErrorEventSchema,
  ])
  .meta({
    $id: WORKER_SCHEMA_ID,
    title: "CNC Render Worker Protocol",
  });

export type WorkerMessage = z.infer<typeof WorkerMessageSchema>;

export type WorkerProtocolIssue = Readonly<{
  code:
    | "message.duplicate"
    | "sequence.not_monotonic"
    | "run.disposed"
    | "reply.unknown"
    | "reply.type_mismatch"
    | "reply.run_mismatch"
    | "message.invalid";
  path: readonly PropertyKey[];
  message: string;
}>;

export type WorkerProtocolResult =
  | Readonly<{ success: true; message: WorkerMessage }>
  | Readonly<{ success: false; issues: readonly WorkerProtocolIssue[] }>;

function containsBinaryPayload(value: unknown): boolean {
  if (
    value instanceof ArrayBuffer ||
    ArrayBuffer.isView(value) ||
    (typeof SharedArrayBuffer !== "undefined" &&
      value instanceof SharedArrayBuffer) ||
    (typeof Blob !== "undefined" && value instanceof Blob)
  ) {
    return true;
  }
  if (Array.isArray(value)) {
    return value.some(containsBinaryPayload);
  }
  if (value && typeof value === "object") {
    return Object.values(value).some(containsBinaryPayload);
  }
  return false;
}

function replyIssue(
  code: "reply.unknown" | "reply.type_mismatch" | "reply.run_mismatch",
  message: string,
): WorkerProtocolResult {
  return {
    success: false,
    issues: [{ code, path: ["replyTo"], message }],
  };
}

export class WorkerProtocolValidator {
  readonly #messages = new Map<string, WorkerMessage>();
  readonly #lastSequence = new Map<string, number>();
  readonly #disposedRuns = new Set<string>();

  accept(input: unknown): WorkerProtocolResult {
    if (containsBinaryPayload(input)) {
      return {
        success: false,
        issues: [
          {
            code: "message.invalid",
            path: ["payload"],
            message:
              "binary data must use a transfer list and an opaque handle descriptor",
          },
        ],
      };
    }

    const parsed = WorkerMessageSchema.safeParse(input);
    if (!parsed.success) {
      return {
        success: false,
        issues: parsed.error.issues.map((issue) => ({
          code: "message.invalid" as const,
          path: issue.path,
          message: issue.message,
        })),
      };
    }

    const message = parsed.data;
    if (this.#messages.has(message.messageId)) {
      return {
        success: false,
        issues: [
          {
            code: "message.duplicate",
            path: ["messageId"],
            message: "messageId has already been accepted",
          },
        ],
      };
    }

    if (message.replyTo !== null) {
      const target = this.#messages.get(message.replyTo);
      if (!target) {
        return replyIssue(
          "reply.unknown",
          "replyTo must reference a previously accepted message",
        );
      }
      if (
        message.type === "worker.ready" &&
        target.type !== "worker.handshake"
      ) {
        return replyIssue(
          "reply.type_mismatch",
          "worker.ready must reply to worker.handshake",
        );
      }
      if (
        (message.type === "project.accepted" ||
          message.type === "project.rejected") &&
        target.type !== "project.load"
      ) {
        return replyIssue(
          "reply.type_mismatch",
          "project result must reply to project.load",
        );
      }
      if (
        message.runId !== null &&
        target.runId !== null &&
        message.runId !== target.runId
      ) {
        return replyIssue(
          "reply.run_mismatch",
          "reply and target must belong to the same run",
        );
      }
    }

    if (message.runId !== null) {
      if (this.#disposedRuns.has(message.runId)) {
        return {
          success: false,
          issues: [
            {
              code: "run.disposed",
              path: ["runId"],
              message: "messages for a disposed run are stale",
            },
          ],
        };
      }

      const sequenceKey = `${message.kind}:${message.runId}`;
      const lastSequence = this.#lastSequence.get(sequenceKey);
      if (lastSequence !== undefined && message.sequence <= lastSequence) {
        return {
          success: false,
          issues: [
            {
              code: "sequence.not_monotonic",
              path: ["sequence"],
              message: "sequence must increase monotonically within a run",
            },
          ],
        };
      }
      this.#lastSequence.set(sequenceKey, message.sequence);
    }

    this.#messages.set(message.messageId, message);
    if (message.type === "run.dispose") {
      this.#disposedRuns.add(message.runId);
    }

    return { success: true, message };
  }
}

export function workerJsonSchema(): z.core.JSONSchema.JSONSchema {
  return z.toJSONSchema(WorkerMessageSchema, {
    target: "draft-2020-12",
    io: "input",
    unrepresentable: "throw",
    cycles: "throw",
    reused: "inline",
  });
}
