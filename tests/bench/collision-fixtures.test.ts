import {
  COLLISION_GROUP,
  CollisionEngine,
  type CollisionProxy,
} from "@cnc-render/simulation";
import { describe, expect, it } from "vitest";

const CUTTER_ID = "24000000-0000-4000-8000-000000000001";

function fixtureId(index: number): string {
  return `24000000-0000-4000-8000-${String(index + 100).padStart(12, "0")}`;
}

function createCollisionFixtureGrid(): readonly CollisionProxy[] {
  const cutter: CollisionProxy = {
    id: CUTTER_ID,
    semanticKind: "cutter",
    visualObjectId: "benchmark/cutter-visual",
    collisionGroup: COLLISION_GROUP.cutter,
    collisionMask: COLLISION_GROUP.workholding,
    severity: "stop",
    shape: {
      shapeType: "sphere",
      centerMm: { xMm: -20, yMm: 0, zMm: 0 },
      radiusMm: 3,
    },
  };
  const fixtures = Array.from({ length: 120 }, (_, index) => {
    const column = index % 12;
    const row = Math.floor(index / 12);
    return {
      id: fixtureId(index),
      semanticKind: index % 2 === 0 ? "vise" : "chuck",
      visualObjectId: `benchmark/workholding-visual-${index}`,
      collisionGroup: COLLISION_GROUP.workholding,
      collisionMask: COLLISION_GROUP.cutter,
      severity: "stop",
      shape: {
        shapeType: "axis-aligned-box",
        centerMm: {
          xMm: column * 20,
          yMm: row * 20,
          zMm: 0,
        },
        halfExtentsMm: { xMm: 4, yMm: 4, zMm: 4 },
      },
    } satisfies CollisionProxy;
  });
  return [cutter, ...fixtures];
}

describe("M4 collision fixture benchmark", () => {
  it("keeps 2,000 broad/narrow fixture frames inside the CPU budget", () => {
    const engine = new CollisionEngine(createCollisionFixtureGrid());
    let broadPhasePairs = 0;
    let narrowPhaseTests = 0;
    let contacts = 0;
    const frameCount = 2_000;
    const startedAt = performance.now();

    for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
      const columnPosition = frameIndex % 240;
      const row = Math.floor(frameIndex / 240) % 10;
      const result = engine.detectFrame({
        timeS: frameIndex / 60,
        sourceLine: 100 + frameIndex,
        translationsMm: {
          [CUTTER_ID]: {
            xMm: columnPosition,
            yMm: row * 20,
            zMm: 0,
          },
        },
      });
      broadPhasePairs += result.broadPhasePairs;
      narrowPhaseTests += result.narrowPhaseTests;
      contacts += result.contacts.length;
    }

    const durationMs = performance.now() - startedAt;
    expect(contacts).toBeGreaterThan(0);
    expect(narrowPhaseTests).toBe(broadPhasePairs);
    expect(durationMs).toBeLessThanOrEqual(1_500);
    expect(durationMs / frameCount).toBeLessThanOrEqual(0.75);
  });
});
