import {
  COLLISION_GROUP,
  CollisionEngine,
  CollisionInputError,
  interpolateCollisionFrames,
  type CollisionProxy,
  type CollisionTimelineResult,
} from "./collision";

export const M4_COLLISION_DEMO_RUN_ID =
  "25000000-0000-4000-8000-000000000000";

const CUTTER_PROXY_ID = "25000000-0000-4000-8000-000000000001";
const VISE_PROXY_ID = "25000000-0000-4000-8000-000000000004";

const DEMO_PROXIES: readonly CollisionProxy[] = [
  {
    id: CUTTER_PROXY_ID,
    semanticKind: "cutter",
    visualObjectId: "scene/cutter",
    collisionGroup: COLLISION_GROUP.cutter,
    collisionMask: COLLISION_GROUP.workholding,
    severity: "stop",
    shape: {
      shapeType: "sphere",
      centerMm: { xMm: 0, yMm: -122, zMm: 420 },
      radiusMm: 10,
    },
  },
  {
    id: VISE_PROXY_ID,
    semanticKind: "vise",
    visualObjectId: "scene/vise",
    collisionGroup: COLLISION_GROUP.workholding,
    collisionMask: COLLISION_GROUP.cutter,
    severity: "stop",
    shape: {
      shapeType: "axis-aligned-box",
      centerMm: { xMm: 0, yMm: -122, zMm: 236 },
      halfExtentsMm: { xMm: 245, yMm: 24, zMm: 46 },
    },
  },
];

export function runM4CollisionStopDemo(): CollisionTimelineResult {
  const engine = new CollisionEngine(DEMO_PROXIES);
  const frames = interpolateCollisionFrames(
    {
      timeS: 0,
      sourceLine: 2,
      translationsMm: {},
    },
    {
      timeS: 1,
      sourceLine: 3,
      translationsMm: {
        [CUTTER_PROXY_ID]: { xMm: 0, yMm: 0, zMm: -145 },
      },
    },
    5,
  );
  const result = engine.scanTimeline(frames, {
    runId: M4_COLLISION_DEMO_RUN_ID,
  });

  if (
    !result.stopped ||
    result.events.length !== 1 ||
    result.events[0].sourceLine !== 3
  ) {
    throw new CollisionInputError(
      "collision.demo.fixture-invalid",
      "The M4 collision-stop demo must produce one source-mapped stop event.",
    );
  }
  return result;
}
