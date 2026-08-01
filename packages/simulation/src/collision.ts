import {
  SimulationCollisionEventSchema,
  UuidSchema,
  type SimulationEvent,
  type Vec3Mm,
} from "@cnc-render/contracts";

const COLLISION_EPSILON_MM = 1e-9;
const MAX_TIMELINE_FRAMES = 1_000_000;
const MAX_COLLISION_SEQUENCE = Number.MAX_SAFE_INTEGER;
const MAX_COLLISION_GROUP = 1 << 30;
const MAX_COLLISION_MASK = 0x7fff_ffff;

export const COLLISION_GROUP = {
  cutter: 1 << 0,
  holder: 1 << 1,
  workholding: 1 << 2,
  stock: 1 << 3,
  machine: 1 << 4,
} as const;

export type CollisionSemanticKind =
  | "cutter"
  | "holder"
  | "chuck"
  | "vise"
  | "stock"
  | "fixture"
  | "machine";

const COLLISION_SEMANTIC_KINDS: readonly CollisionSemanticKind[] = [
  "cutter",
  "holder",
  "chuck",
  "vise",
  "stock",
  "fixture",
  "machine",
];

export interface SphereCollisionShape {
  readonly shapeType: "sphere";
  readonly centerMm: Vec3Mm;
  readonly radiusMm: number;
}

export interface AxisAlignedBoxCollisionShape {
  readonly shapeType: "axis-aligned-box";
  readonly centerMm: Vec3Mm;
  readonly halfExtentsMm: Vec3Mm;
}

export type CollisionShape =
  | SphereCollisionShape
  | AxisAlignedBoxCollisionShape;

export interface CollisionProxy {
  readonly id: string;
  readonly semanticKind: CollisionSemanticKind;
  readonly visualObjectId: string;
  readonly collisionGroup: number;
  readonly collisionMask: number;
  readonly severity: "warning" | "stop";
  readonly shape: CollisionShape;
}

export interface CollisionFrame {
  readonly timeS: number;
  readonly sourceLine: number | null;
  readonly translationsMm: Readonly<Record<string, Vec3Mm>>;
}

export interface CollisionContact {
  readonly pairKey: string;
  readonly objectAId: string;
  readonly objectBId: string;
  readonly objectAKind: CollisionSemanticKind;
  readonly objectBKind: CollisionSemanticKind;
  readonly severity: "warning" | "stop";
  readonly positionMm: Vec3Mm;
  readonly penetrationEstimateMm: number;
}

export type CollisionEvent = Extract<
  SimulationEvent,
  { eventType: "simulation.collision" }
>;

export interface CollisionFrameResult {
  readonly contacts: readonly CollisionContact[];
  readonly broadPhasePairs: number;
  readonly narrowPhaseTests: number;
}

export interface CollisionTimelineResult {
  readonly events: readonly CollisionEvent[];
  readonly stopped: boolean;
  readonly stoppedAtTimeS: number | null;
  readonly framesProcessed: number;
  readonly broadPhasePairs: number;
  readonly narrowPhaseTests: number;
}

export class CollisionInputError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "CollisionInputError";
    this.code = code;
  }
}

interface BoundsMm {
  readonly min: Vec3Mm;
  readonly max: Vec3Mm;
}

interface PositionedProxy {
  readonly proxy: CollisionProxy;
  readonly shape: CollisionShape;
  readonly bounds: BoundsMm;
}

function normalizedZero(value: number): number {
  return Object.is(value, -0) ? 0 : value;
}

function finiteVec3(value: unknown): value is Vec3Mm {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const vector = value as Partial<Vec3Mm>;
  return (
    Number.isFinite(vector.xMm) &&
    Number.isFinite(vector.yMm) &&
    Number.isFinite(vector.zMm)
  );
}

function add(left: Vec3Mm, right: Vec3Mm): Vec3Mm {
  return {
    xMm: normalizedZero(left.xMm + right.xMm),
    yMm: normalizedZero(left.yMm + right.yMm),
    zMm: normalizedZero(left.zMm + right.zMm),
  };
}

function subtract(left: Vec3Mm, right: Vec3Mm): Vec3Mm {
  return {
    xMm: left.xMm - right.xMm,
    yMm: left.yMm - right.yMm,
    zMm: left.zMm - right.zMm,
  };
}

function scale(vector: Vec3Mm, scalar: number): Vec3Mm {
  return {
    xMm: normalizedZero(vector.xMm * scalar),
    yMm: normalizedZero(vector.yMm * scalar),
    zMm: normalizedZero(vector.zMm * scalar),
  };
}

function distance(left: Vec3Mm, right: Vec3Mm): number {
  return Math.hypot(
    right.xMm - left.xMm,
    right.yMm - left.yMm,
    right.zMm - left.zMm,
  );
}

function pairKey(leftId: string, rightId: string): string {
  return leftId < rightId
    ? `${leftId}:${rightId}`
    : `${rightId}:${leftId}`;
}

function validateProxy(proxy: CollisionProxy): void {
  if (!UuidSchema.safeParse(proxy.id).success) {
    throw new CollisionInputError(
      "collision.proxy.id-invalid",
      `Collision proxy "${proxy.id}" must use a contract UUID.`,
    );
  }
  if (
    typeof proxy.visualObjectId !== "string" ||
    proxy.visualObjectId.length === 0 ||
    proxy.visualObjectId === proxy.id
  ) {
    throw new CollisionInputError(
      "collision.proxy.visual-link-invalid",
      `Collision proxy "${proxy.id}" must link to a distinct visual object.`,
    );
  }
  if (!COLLISION_SEMANTIC_KINDS.includes(proxy.semanticKind)) {
    throw new CollisionInputError(
      "collision.proxy.semantic-kind-invalid",
      `Collision proxy "${proxy.id}" has an unsupported semantic kind.`,
    );
  }
  if (proxy.severity !== "warning" && proxy.severity !== "stop") {
    throw new CollisionInputError(
      "collision.proxy.severity-invalid",
      `Collision proxy "${proxy.id}" requires warning or stop severity.`,
    );
  }
  if (
    !Number.isSafeInteger(proxy.collisionGroup) ||
    proxy.collisionGroup <= 0 ||
    proxy.collisionGroup > MAX_COLLISION_GROUP ||
    (proxy.collisionGroup & (proxy.collisionGroup - 1)) !== 0
  ) {
    throw new CollisionInputError(
      "collision.proxy.group-invalid",
      `Collision proxy "${proxy.id}" requires a positive one-bit group within the signed 31-bit mask range.`,
    );
  }
  if (
    !Number.isSafeInteger(proxy.collisionMask) ||
    proxy.collisionMask <= 0 ||
    proxy.collisionMask > MAX_COLLISION_MASK
  ) {
    throw new CollisionInputError(
      "collision.proxy.mask-invalid",
      `Collision proxy "${proxy.id}" requires a positive signed 31-bit collision mask.`,
    );
  }
  if (
    !proxy.shape ||
    typeof proxy.shape !== "object" ||
    (proxy.shape.shapeType !== "sphere" &&
      proxy.shape.shapeType !== "axis-aligned-box")
  ) {
    throw new CollisionInputError(
      "collision.proxy.shape-invalid",
      `Collision proxy "${proxy.id}" requires a supported simple shape.`,
    );
  }
  if (!finiteVec3(proxy.shape.centerMm)) {
    throw new CollisionInputError(
      "collision.proxy.shape-invalid",
      `Collision proxy "${proxy.id}" has a non-finite center.`,
    );
  }
  if (
    proxy.shape.shapeType === "sphere" &&
    (!Number.isFinite(proxy.shape.radiusMm) ||
      proxy.shape.radiusMm <= 0)
  ) {
    throw new CollisionInputError(
      "collision.proxy.shape-invalid",
      `Collision proxy "${proxy.id}" requires a positive sphere radius.`,
    );
  }
  if (
    proxy.shape.shapeType === "axis-aligned-box" &&
    (!finiteVec3(proxy.shape.halfExtentsMm) ||
      proxy.shape.halfExtentsMm.xMm <= 0 ||
      proxy.shape.halfExtentsMm.yMm <= 0 ||
      proxy.shape.halfExtentsMm.zMm <= 0)
  ) {
    throw new CollisionInputError(
      "collision.proxy.shape-invalid",
      `Collision proxy "${proxy.id}" requires positive box half-extents.`,
    );
  }
}

function translateShape(
  shape: CollisionShape,
  translationMm: Vec3Mm,
): CollisionShape {
  return {
    ...shape,
    centerMm: add(shape.centerMm, translationMm),
  };
}

function boundsFor(shape: CollisionShape): BoundsMm {
  const halfExtents =
    shape.shapeType === "sphere"
      ? {
          xMm: shape.radiusMm,
          yMm: shape.radiusMm,
          zMm: shape.radiusMm,
        }
      : shape.halfExtentsMm;
  return {
    min: subtract(shape.centerMm, halfExtents),
    max: add(shape.centerMm, halfExtents),
  };
}

function boundsOverlap(left: BoundsMm, right: BoundsMm): boolean {
  return (
    left.min.xMm < right.max.xMm - COLLISION_EPSILON_MM &&
    left.max.xMm > right.min.xMm + COLLISION_EPSILON_MM &&
    left.min.yMm < right.max.yMm - COLLISION_EPSILON_MM &&
    left.max.yMm > right.min.yMm + COLLISION_EPSILON_MM &&
    left.min.zMm < right.max.zMm - COLLISION_EPSILON_MM &&
    left.max.zMm > right.min.zMm + COLLISION_EPSILON_MM
  );
}

function pairEnabled(
  left: CollisionProxy,
  right: CollisionProxy,
): boolean {
  return (
    (left.collisionMask & right.collisionGroup) !== 0 &&
    (right.collisionMask & left.collisionGroup) !== 0
  );
}

function sphereSphere(
  left: SphereCollisionShape,
  right: SphereCollisionShape,
): { positionMm: Vec3Mm; penetrationEstimateMm: number } | null {
  const centerDistance = distance(left.centerMm, right.centerMm);
  const penetrationEstimateMm =
    left.radiusMm + right.radiusMm - centerDistance;
  if (penetrationEstimateMm <= COLLISION_EPSILON_MM) {
    return null;
  }

  const direction =
    centerDistance <= COLLISION_EPSILON_MM
      ? { xMm: 1, yMm: 0, zMm: 0 }
      : scale(
          subtract(right.centerMm, left.centerMm),
          1 / centerDistance,
        );
  return {
    positionMm: add(
      left.centerMm,
      scale(
        direction,
        left.radiusMm - penetrationEstimateMm / 2,
      ),
    ),
    penetrationEstimateMm,
  };
}

function boxBox(
  left: AxisAlignedBoxCollisionShape,
  right: AxisAlignedBoxCollisionShape,
): { positionMm: Vec3Mm; penetrationEstimateMm: number } | null {
  const leftBounds = boundsFor(left);
  const rightBounds = boundsFor(right);
  const overlaps = {
    xMm:
      Math.min(leftBounds.max.xMm, rightBounds.max.xMm) -
      Math.max(leftBounds.min.xMm, rightBounds.min.xMm),
    yMm:
      Math.min(leftBounds.max.yMm, rightBounds.max.yMm) -
      Math.max(leftBounds.min.yMm, rightBounds.min.yMm),
    zMm:
      Math.min(leftBounds.max.zMm, rightBounds.max.zMm) -
      Math.max(leftBounds.min.zMm, rightBounds.min.zMm),
  };
  const penetrationEstimateMm = Math.min(
    overlaps.xMm,
    overlaps.yMm,
    overlaps.zMm,
  );
  if (penetrationEstimateMm <= COLLISION_EPSILON_MM) {
    return null;
  }
  return {
    positionMm: {
      xMm:
        (Math.max(leftBounds.min.xMm, rightBounds.min.xMm) +
          Math.min(leftBounds.max.xMm, rightBounds.max.xMm)) /
        2,
      yMm:
        (Math.max(leftBounds.min.yMm, rightBounds.min.yMm) +
          Math.min(leftBounds.max.yMm, rightBounds.max.yMm)) /
        2,
      zMm:
        (Math.max(leftBounds.min.zMm, rightBounds.min.zMm) +
          Math.min(leftBounds.max.zMm, rightBounds.max.zMm)) /
        2,
    },
    penetrationEstimateMm,
  };
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function sphereBox(
  sphere: SphereCollisionShape,
  box: AxisAlignedBoxCollisionShape,
): { positionMm: Vec3Mm; penetrationEstimateMm: number } | null {
  const bounds = boundsFor(box);
  const closest = {
    xMm: clamp(sphere.centerMm.xMm, bounds.min.xMm, bounds.max.xMm),
    yMm: clamp(sphere.centerMm.yMm, bounds.min.yMm, bounds.max.yMm),
    zMm: clamp(sphere.centerMm.zMm, bounds.min.zMm, bounds.max.zMm),
  };
  const centerDistance = distance(sphere.centerMm, closest);

  if (centerDistance > COLLISION_EPSILON_MM) {
    const penetrationEstimateMm = sphere.radiusMm - centerDistance;
    return penetrationEstimateMm > COLLISION_EPSILON_MM
      ? { positionMm: closest, penetrationEstimateMm }
      : null;
  }

  const faces = [
    {
      distanceMm: sphere.centerMm.xMm - bounds.min.xMm,
      positionMm: { ...sphere.centerMm, xMm: bounds.min.xMm },
    },
    {
      distanceMm: bounds.max.xMm - sphere.centerMm.xMm,
      positionMm: { ...sphere.centerMm, xMm: bounds.max.xMm },
    },
    {
      distanceMm: sphere.centerMm.yMm - bounds.min.yMm,
      positionMm: { ...sphere.centerMm, yMm: bounds.min.yMm },
    },
    {
      distanceMm: bounds.max.yMm - sphere.centerMm.yMm,
      positionMm: { ...sphere.centerMm, yMm: bounds.max.yMm },
    },
    {
      distanceMm: sphere.centerMm.zMm - bounds.min.zMm,
      positionMm: { ...sphere.centerMm, zMm: bounds.min.zMm },
    },
    {
      distanceMm: bounds.max.zMm - sphere.centerMm.zMm,
      positionMm: { ...sphere.centerMm, zMm: bounds.max.zMm },
    },
  ].sort((left, right) => left.distanceMm - right.distanceMm);
  return {
    positionMm: faces[0].positionMm,
    penetrationEstimateMm: sphere.radiusMm + faces[0].distanceMm,
  };
}

function narrowPhase(
  left: CollisionShape,
  right: CollisionShape,
): { positionMm: Vec3Mm; penetrationEstimateMm: number } | null {
  if (left.shapeType === "sphere" && right.shapeType === "sphere") {
    return sphereSphere(left, right);
  }
  if (
    left.shapeType === "axis-aligned-box" &&
    right.shapeType === "axis-aligned-box"
  ) {
    return boxBox(left, right);
  }
  return left.shapeType === "sphere"
    ? sphereBox(left, right as AxisAlignedBoxCollisionShape)
    : sphereBox(
        right as SphereCollisionShape,
        left as AxisAlignedBoxCollisionShape,
      );
}

function validateFrame(
  frame: CollisionFrame,
  knownProxyIds: ReadonlySet<string>,
): void {
  if (!Number.isFinite(frame.timeS) || frame.timeS < 0) {
    throw new CollisionInputError(
      "collision.frame.time-invalid",
      "Collision frame time must be finite and non-negative.",
    );
  }
  if (
    frame.sourceLine !== null &&
    (!Number.isSafeInteger(frame.sourceLine) || frame.sourceLine <= 0)
  ) {
    throw new CollisionInputError(
      "collision.frame.source-line-invalid",
      "Collision frame sourceLine must be a positive safe integer or null.",
    );
  }
  for (const proxyId of Object.keys(frame.translationsMm)) {
    if (!knownProxyIds.has(proxyId)) {
      throw new CollisionInputError(
        "collision.frame.proxy-unknown",
        `Collision frame references unknown proxy "${proxyId}".`,
      );
    }
    if (!finiteVec3(frame.translationsMm[proxyId])) {
      throw new CollisionInputError(
        "collision.frame.translation-invalid",
        `Collision frame translation for "${proxyId}" must be finite.`,
      );
    }
  }
}

export function interpolateCollisionFrames(
  start: CollisionFrame,
  end: CollisionFrame,
  maximumTranslationStepMm: number,
): readonly CollisionFrame[] {
  if (
    !Number.isFinite(maximumTranslationStepMm) ||
    maximumTranslationStepMm <= 0
  ) {
    throw new CollisionInputError(
      "collision.interpolation.step-invalid",
      "Collision interpolation step must be finite and positive.",
    );
  }
  if (
    !Number.isFinite(start.timeS) ||
    !Number.isFinite(end.timeS) ||
    start.timeS < 0 ||
    end.timeS <= start.timeS
  ) {
    throw new CollisionInputError(
      "collision.interpolation.time-invalid",
      "Collision interpolation endpoints require increasing finite times.",
    );
  }

  const proxyIds = [...new Set([
    ...Object.keys(start.translationsMm),
    ...Object.keys(end.translationsMm),
  ])].sort((left, right) => left.localeCompare(right, "en-US"));
  const zero = { xMm: 0, yMm: 0, zMm: 0 };
  let maximumTravelMm = 0;
  for (const proxyId of proxyIds) {
    const startTranslation = start.translationsMm[proxyId] ?? zero;
    const endTranslation = end.translationsMm[proxyId] ?? zero;
    if (!finiteVec3(startTranslation) || !finiteVec3(endTranslation)) {
      throw new CollisionInputError(
        "collision.frame.translation-invalid",
        `Collision interpolation for "${proxyId}" must be finite.`,
      );
    }
    maximumTravelMm = Math.max(
      maximumTravelMm,
      distance(startTranslation, endTranslation),
    );
  }

  const stepCount = Math.max(
    1,
    Math.ceil(maximumTravelMm / maximumTranslationStepMm),
  );
  if (stepCount > MAX_TIMELINE_FRAMES) {
    throw new CollisionInputError(
      "collision.interpolation.limit",
      `Collision interpolation exceeds ${MAX_TIMELINE_FRAMES} frames.`,
    );
  }

  return Array.from({ length: stepCount + 1 }, (_, stepIndex) => {
    const ratio = stepIndex / stepCount;
    return {
      timeS: normalizedZero(
        start.timeS + (end.timeS - start.timeS) * ratio,
      ),
      sourceLine: stepIndex === 0 ? start.sourceLine : end.sourceLine,
      translationsMm: Object.fromEntries(
        proxyIds.map((proxyId) => {
          const from = start.translationsMm[proxyId] ?? zero;
          const to = end.translationsMm[proxyId] ?? zero;
          return [
            proxyId,
            add(from, scale(subtract(to, from), ratio)),
          ];
        }),
      ),
    };
  });
}

export class CollisionEngine {
  readonly #proxies: readonly CollisionProxy[];
  readonly #proxyIds: ReadonlySet<string>;

  constructor(proxies: readonly CollisionProxy[]) {
    if (proxies.length < 2) {
      throw new CollisionInputError(
        "collision.scene.proxy-count",
        "Collision scenes require at least two proxies.",
      );
    }
    const ids = new Set<string>();
    for (const proxy of proxies) {
      validateProxy(proxy);
      if (ids.has(proxy.id)) {
        throw new CollisionInputError(
          "collision.proxy.id-duplicate",
          `Duplicate collision proxy "${proxy.id}".`,
        );
      }
      ids.add(proxy.id);
    }
    this.#proxies = [...proxies].sort((left, right) =>
      left.id.localeCompare(right.id, "en-US"),
    );
    this.#proxyIds = ids;
  }

  detectFrame(frame: CollisionFrame): CollisionFrameResult {
    validateFrame(frame, this.#proxyIds);
    const zero = { xMm: 0, yMm: 0, zMm: 0 };
    const positioned = this.#proxies
      .map<PositionedProxy>((proxy) => {
        const shape = translateShape(
          proxy.shape,
          frame.translationsMm[proxy.id] ?? zero,
        );
        return { proxy, shape, bounds: boundsFor(shape) };
      })
      .sort(
        (left, right) =>
          left.bounds.min.xMm - right.bounds.min.xMm ||
          left.proxy.id.localeCompare(right.proxy.id, "en-US"),
      );

    const candidates: [PositionedProxy, PositionedProxy][] = [];
    for (let leftIndex = 0; leftIndex < positioned.length; leftIndex += 1) {
      const left = positioned[leftIndex];
      for (
        let rightIndex = leftIndex + 1;
        rightIndex < positioned.length;
        rightIndex += 1
      ) {
        const right = positioned[rightIndex];
        if (
          right.bounds.min.xMm >=
          left.bounds.max.xMm - COLLISION_EPSILON_MM
        ) {
          break;
        }
        if (
          pairEnabled(left.proxy, right.proxy) &&
          boundsOverlap(left.bounds, right.bounds)
        ) {
          candidates.push([left, right]);
        }
      }
    }

    const contacts = candidates
      .map(([left, right]) => {
        const contact = narrowPhase(left.shape, right.shape);
        if (!contact) {
          return null;
        }
        const [objectA, objectB] =
          left.proxy.id < right.proxy.id
            ? [left.proxy, right.proxy]
            : [right.proxy, left.proxy];
        return {
          pairKey: pairKey(objectA.id, objectB.id),
          objectAId: objectA.id,
          objectBId: objectB.id,
          objectAKind: objectA.semanticKind,
          objectBKind: objectB.semanticKind,
          severity:
            objectA.severity === "stop" || objectB.severity === "stop"
              ? ("stop" as const)
              : ("warning" as const),
          positionMm: contact.positionMm,
          penetrationEstimateMm: contact.penetrationEstimateMm,
        };
      })
      .filter((contact): contact is CollisionContact => contact !== null)
      .sort((left, right) =>
        left.pairKey.localeCompare(right.pairKey, "en-US"),
      );

    return {
      contacts,
      broadPhasePairs: candidates.length,
      narrowPhaseTests: candidates.length,
    };
  }

  scanTimeline(
    frames: readonly CollisionFrame[],
    options: {
      readonly runId: string;
      readonly sequenceStart?: number;
    },
  ): CollisionTimelineResult {
    if (frames.length > MAX_TIMELINE_FRAMES) {
      throw new CollisionInputError(
        "collision.timeline.limit",
        `Collision timeline exceeds ${MAX_TIMELINE_FRAMES} frames.`,
      );
    }
    if (!UuidSchema.safeParse(options.runId).success) {
      throw new CollisionInputError(
        "collision.timeline.run-id-invalid",
        "Collision timeline runId must use a contract UUID.",
      );
    }
    let sequence = options.sequenceStart ?? 0;
    if (
      !Number.isSafeInteger(sequence) ||
      sequence < 0 ||
      sequence > MAX_COLLISION_SEQUENCE
    ) {
      throw new CollisionInputError(
        "collision.timeline.sequence-invalid",
        "Collision sequenceStart must be a non-negative safe integer.",
      );
    }

    let priorTimeS = -1;
    let activePairs = new Set<string>();
    let broadPhasePairs = 0;
    let narrowPhaseTests = 0;
    const events: CollisionEvent[] = [];

    for (let frameIndex = 0; frameIndex < frames.length; frameIndex += 1) {
      const frame = frames[frameIndex];
      if (frame.timeS <= priorTimeS) {
        throw new CollisionInputError(
          "collision.timeline.time-order",
          "Collision frame times must be strictly increasing.",
        );
      }
      priorTimeS = frame.timeS;
      const result = this.detectFrame(frame);
      broadPhasePairs += result.broadPhasePairs;
      narrowPhaseTests += result.narrowPhaseTests;
      const currentPairs = new Set(
        result.contacts.map((contact) => contact.pairKey),
      );
      let stopAtThisFrame = false;

      for (const contact of result.contacts) {
        if (activePairs.has(contact.pairKey)) {
          continue;
        }
        if (sequence > MAX_COLLISION_SEQUENCE) {
          throw new CollisionInputError(
            "collision.timeline.sequence-overflow",
            "Collision event sequence exceeds the safe integer range.",
          );
        }
        const parsed = SimulationCollisionEventSchema.safeParse({
          schemaVersion: 1,
          runId: options.runId,
          sequence,
          timeS: frame.timeS,
          eventType: "simulation.collision",
          severity: contact.severity,
          objectAId: contact.objectAId,
          objectBId: contact.objectBId,
          positionMm: contact.positionMm,
          penetrationEstimateMm: contact.penetrationEstimateMm,
          sourceLine: frame.sourceLine,
        });
        if (!parsed.success) {
          throw new CollisionInputError(
            "collision.event.contract-invalid",
            parsed.error.issues
              .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
              .join("; "),
          );
        }
        events.push(parsed.data);
        sequence += 1;
        stopAtThisFrame ||= contact.severity === "stop";
      }

      if (stopAtThisFrame) {
        return {
          events,
          stopped: true,
          stoppedAtTimeS: frame.timeS,
          framesProcessed: frameIndex + 1,
          broadPhasePairs,
          narrowPhaseTests,
        };
      }
      activePairs = currentPairs;
    }

    return {
      events,
      stopped: false,
      stoppedAtTimeS: null,
      framesProcessed: frames.length,
      broadPhasePairs,
      narrowPhaseTests,
    };
  }
}
