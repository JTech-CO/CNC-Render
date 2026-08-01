import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { SimulationCollisionEventSchema } from "@cnc-render/contracts";
import {
  COLLISION_GROUP,
  CollisionEngine,
  CollisionInputError,
  interpolateCollisionFrames,
  runM4CollisionStopDemo,
  type CollisionFrame,
  type CollisionProxy,
} from "@cnc-render/simulation";
import { describe, expect, it } from "vitest";

interface ExpectedCollisionEvent {
  readonly objectAId: string;
  readonly objectBId: string;
  readonly severity: "warning" | "stop";
  readonly sourceLine: number | null;
  readonly timeS: number;
}

interface CollisionFixture {
  readonly fixtureVersion: number;
  readonly fixtureId: string;
  readonly runId: string;
  readonly objects: readonly CollisionProxy[];
  readonly frames: readonly CollisionFrame[];
  readonly maximumInterpolationStepMm?: number;
  readonly expectedEvents: readonly ExpectedCollisionEvent[];
}

const fixturesRoot = fileURLToPath(
  new URL("../fixtures/collisions", import.meta.url),
);

function loadFixtures(category: "safe" | "impact"): readonly CollisionFixture[] {
  const directory = join(fixturesRoot, category);
  return readdirSync(directory)
    .filter((name) => name.endsWith(".json"))
    .sort((left, right) => left.localeCompare(right, "en-US"))
    .map((name) =>
      JSON.parse(readFileSync(join(directory, name), "utf8")),
    ) as CollisionFixture[];
}

const safeFixtures = loadFixtures("safe");
const impactFixtures = loadFixtures("impact");

function timelineFrames(
  fixture: CollisionFixture,
): readonly CollisionFrame[] {
  if (
    fixture.maximumInterpolationStepMm === undefined ||
    fixture.frames.length < 2
  ) {
    return fixture.frames;
  }

  const expanded: CollisionFrame[] = [fixture.frames[0]];
  for (let index = 1; index < fixture.frames.length; index += 1) {
    expanded.push(
      ...interpolateCollisionFrames(
        fixture.frames[index - 1],
        fixture.frames[index],
        fixture.maximumInterpolationStepMm,
      ).slice(1),
    );
  }
  return expanded;
}

function sortedPair(leftId: string, rightId: string): readonly string[] {
  return [leftId, rightId].sort((left, right) =>
    left.localeCompare(right, "en-US"),
  );
}

function sphereProxy(
  id: string,
  options: Partial<CollisionProxy> = {},
): CollisionProxy {
  return {
    id,
    semanticKind: "cutter",
    visualObjectId: `visual/${id}`,
    collisionGroup: COLLISION_GROUP.cutter,
    collisionMask: COLLISION_GROUP.holder,
    severity: "stop",
    shape: {
      shapeType: "sphere",
      centerMm: { xMm: 0, yMm: 0, zMm: 0 },
      radiusMm: 5,
    },
    ...options,
  } as CollisionProxy;
}

function boxProxy(
  id: string,
  options: Partial<CollisionProxy> = {},
): CollisionProxy {
  return {
    id,
    semanticKind: "vise",
    visualObjectId: `visual/${id}`,
    collisionGroup: COLLISION_GROUP.holder,
    collisionMask: COLLISION_GROUP.cutter,
    severity: "stop",
    shape: {
      shapeType: "axis-aligned-box",
      centerMm: { xMm: 0, yMm: 0, zMm: 0 },
      halfExtentsMm: { xMm: 4, yMm: 4, zMm: 4 },
    },
    ...options,
  } as CollisionProxy;
}

describe("M4 collision fixtures", () => {
  it.each(safeFixtures)(
    "$fixtureId produces exactly zero collision events",
    (fixture) => {
      const engine = new CollisionEngine(fixture.objects);
      const result = engine.scanTimeline(timelineFrames(fixture), {
        runId: fixture.runId,
      });

      expect(fixture.fixtureVersion).toBe(1);
      expect(fixture.expectedEvents).toEqual([]);
      expect(result.events).toEqual([]);
      expect(result.stopped).toBe(false);
      expect(result.framesProcessed).toBe(timelineFrames(fixture).length);
    },
  );

  it.each(impactFixtures)(
    "$fixtureId emits every expected mapped event and stops",
    (fixture) => {
      const engine = new CollisionEngine(fixture.objects);
      const result = engine.scanTimeline(timelineFrames(fixture), {
        runId: fixture.runId,
        sequenceStart: 7,
      });

      expect(result.stopped).toBe(true);
      expect(result.events).toHaveLength(fixture.expectedEvents.length);
      result.events.forEach((event, index) => {
        const expected = fixture.expectedEvents[index];
        expect(SimulationCollisionEventSchema.safeParse(event).success).toBe(
          true,
        );
        expect(sortedPair(event.objectAId, event.objectBId)).toEqual(
          sortedPair(expected.objectAId, expected.objectBId),
        );
        expect(event).toMatchObject({
          eventType: "simulation.collision",
          severity: expected.severity,
          sourceLine: expected.sourceLine,
          sequence: 7 + index,
        });
        expect(event.timeS).toBeCloseTo(expected.timeS, 12);
        expect(event.penetrationEstimateMm).toBeGreaterThan(0);
        expect(Object.values(event.positionMm).every(Number.isFinite)).toBe(
          true,
        );
      });
    },
  );

  it("covers cutter, holder, chuck and vise semantic objects", () => {
    const expectedKinds = new Set<string>();
    for (const fixture of impactFixtures) {
      const byId = new Map(
        fixture.objects.map((object) => [object.id, object.semanticKind]),
      );
      const result = new CollisionEngine(fixture.objects).scanTimeline(
        timelineFrames(fixture),
        { runId: fixture.runId },
      );
      for (const event of result.events) {
        expectedKinds.add(byId.get(event.objectAId) ?? "");
        expectedKinds.add(byId.get(event.objectBId) ?? "");
      }
    }
    expect([...expectedKinds].sort()).toEqual([
      "chuck",
      "cutter",
      "holder",
      "vise",
    ]);
  });

  it("keeps visual identities distinct from simple collision proxies", () => {
    for (const fixture of [...safeFixtures, ...impactFixtures]) {
      for (const proxy of fixture.objects) {
        expect(proxy.visualObjectId).not.toBe(proxy.id);
        expect(proxy.visualObjectId.length).toBeGreaterThan(0);
        expect(proxy.shape.shapeType).toMatch(
          /^(axis-aligned-box|sphere)$/u,
        );
        expect("geometry" in proxy.shape).toBe(false);
      }
    }
  });

  it("keeps the browser collision-stop fixture source-mapped and deterministic", () => {
    const baseline = runM4CollisionStopDemo();
    expect(baseline.stopped).toBe(true);
    expect(baseline.events).toHaveLength(1);
    expect(baseline.events[0]).toMatchObject({
      eventType: "simulation.collision",
      severity: "stop",
      sourceLine: 3,
    });
    expect(baseline.events[0].penetrationEstimateMm).toBeGreaterThan(0);

    for (let repetition = 0; repetition < 100; repetition += 1) {
      expect(JSON.stringify(runM4CollisionStopDemo())).toBe(
        JSON.stringify(baseline),
      );
    }
  });
});

describe("M4 broad and narrow collision phases", () => {
  const firstId = "23000000-0000-4000-8000-000000000001";
  const secondId = "23000000-0000-4000-8000-000000000002";
  const thirdId = "23000000-0000-4000-8000-000000000003";
  const runId = "23000000-0000-4000-8000-000000000000";

  it("resolves sphere-sphere, sphere-box and box-box penetration", () => {
    const spherePair = new CollisionEngine([
      sphereProxy(firstId),
      sphereProxy(secondId, {
        semanticKind: "holder",
        collisionGroup: COLLISION_GROUP.holder,
        collisionMask: COLLISION_GROUP.cutter,
        shape: {
          shapeType: "sphere",
          centerMm: { xMm: 8, yMm: 0, zMm: 0 },
          radiusMm: 5,
        },
      }),
    ]).detectFrame({ timeS: 0, sourceLine: 1, translationsMm: {} });
    const sphereBoxPair = new CollisionEngine([
      sphereProxy(firstId),
      boxProxy(secondId),
    ]).detectFrame({ timeS: 0, sourceLine: 1, translationsMm: {} });
    const boxPair = new CollisionEngine([
      boxProxy(firstId, {
        collisionGroup: COLLISION_GROUP.cutter,
        collisionMask: COLLISION_GROUP.holder,
      }),
      boxProxy(secondId, {
        shape: {
          shapeType: "axis-aligned-box",
          centerMm: { xMm: 6, yMm: 0, zMm: 0 },
          halfExtentsMm: { xMm: 4, yMm: 4, zMm: 4 },
        },
      }),
    ]).detectFrame({ timeS: 0, sourceLine: 1, translationsMm: {} });

    expect(spherePair.contacts[0].penetrationEstimateMm).toBeCloseTo(2);
    expect(sphereBoxPair.contacts[0].penetrationEstimateMm).toBeCloseTo(9);
    expect(boxPair.contacts[0].penetrationEstimateMm).toBeCloseTo(2);
    expect(spherePair.broadPhasePairs).toBe(1);
    expect(spherePair.narrowPhaseTests).toBe(1);
  });

  it("filters disabled pairs before narrow phase", () => {
    const result = new CollisionEngine([
      sphereProxy(firstId, { collisionMask: COLLISION_GROUP.stock }),
      boxProxy(secondId),
    ]).detectFrame({ timeS: 0, sourceLine: null, translationsMm: {} });

    expect(result).toEqual({
      contacts: [],
      broadPhasePairs: 0,
      narrowPhaseTests: 0,
    });
  });

  it("finds a rapid swept impact that endpoint-only checks would miss", () => {
    const engine = new CollisionEngine([
      sphereProxy(firstId, {
        shape: {
          shapeType: "sphere",
          centerMm: { xMm: -20, yMm: 0, zMm: 0 },
          radiusMm: 2,
        },
      }),
      boxProxy(secondId, {
        shape: {
          shapeType: "axis-aligned-box",
          centerMm: { xMm: 0, yMm: 0, zMm: 0 },
          halfExtentsMm: { xMm: 2, yMm: 4, zMm: 4 },
        },
      }),
    ]);
    const start = {
      timeS: 0,
      sourceLine: 50,
      translationsMm: {},
    };
    const end = {
      timeS: 0.1,
      sourceLine: 51,
      translationsMm: {
        [firstId]: { xMm: 40, yMm: 0, zMm: 0 },
      },
    };

    expect(
      engine.scanTimeline([start, end], { runId }).events,
    ).toEqual([]);
    const swept = engine.scanTimeline(
      interpolateCollisionFrames(start, end, 1),
      { runId },
    );
    expect(swept.events).toHaveLength(1);
    expect(swept.events[0]).toMatchObject({
      severity: "stop",
      sourceLine: 51,
    });
    expect(swept.stoppedAtTimeS).toBeGreaterThan(0);
    expect(swept.stoppedAtTimeS).toBeLessThan(0.1);
  });

  it("emits all simultaneous contacts before stopping the frame", () => {
    const engine = new CollisionEngine([
      sphereProxy(firstId),
      boxProxy(secondId),
      boxProxy(thirdId, {
        semanticKind: "chuck",
        shape: {
          shapeType: "axis-aligned-box",
          centerMm: { xMm: 2, yMm: 0, zMm: 0 },
          halfExtentsMm: { xMm: 4, yMm: 4, zMm: 4 },
        },
      }),
    ]);
    const result = engine.scanTimeline(
      [{ timeS: 0, sourceLine: 60, translationsMm: {} }],
      { runId },
    );

    expect(result.events).toHaveLength(2);
    expect(result.framesProcessed).toBe(1);
    expect(result.stopped).toBe(true);
  });

  it("fails closed for malformed shape, frame and event inputs", () => {
    expect(
      () =>
        new CollisionEngine([
          sphereProxy(firstId, {
            shape: {
              shapeType: "sphere",
              centerMm: { xMm: 0, yMm: 0, zMm: 0 },
              radiusMm: 0,
            },
          }),
          boxProxy(secondId),
        ]),
    ).toThrowError(CollisionInputError);

    const engine = new CollisionEngine([
      sphereProxy(firstId),
      boxProxy(secondId),
    ]);
    expect(() =>
      engine.detectFrame({
        timeS: 0,
        sourceLine: null,
        translationsMm: {
          [firstId]: { xMm: Number.NaN, yMm: 0, zMm: 0 },
        },
      }),
    ).toThrowError(CollisionInputError);
    expect(() =>
      engine.scanTimeline(
        [{ timeS: 0, sourceLine: 1, translationsMm: {} }],
        { runId: "not-a-uuid" },
      ),
    ).toThrowError(CollisionInputError);
  });

  it("rejects bitmask overflow and unknown proxy discriminants", () => {
    const invalidProxies: readonly CollisionProxy[] = [
      sphereProxy(firstId, { collisionGroup: 2 ** 31 }),
      sphereProxy(firstId, { collisionMask: 2 ** 31 }),
      sphereProxy(firstId, {
        semanticKind: "unknown" as CollisionProxy["semanticKind"],
      }),
      sphereProxy(firstId, {
        severity: "ignore" as CollisionProxy["severity"],
      }),
      sphereProxy(firstId, {
        shape: {
          shapeType: "mesh",
        } as unknown as CollisionProxy["shape"],
      }),
      sphereProxy(firstId, {
        shape: {
          shapeType: "sphere",
          radiusMm: 5,
        } as unknown as CollisionProxy["shape"],
      }),
    ];

    for (const invalidProxy of invalidProxies) {
      expect(
        () => new CollisionEngine([invalidProxy, boxProxy(secondId)]),
      ).toThrowError(CollisionInputError);
    }
  });

  it("is byte-stable across repeated fixture scans", () => {
    const fixture = impactFixtures[0];
    const engine = new CollisionEngine(fixture.objects);
    const frames = timelineFrames(fixture);
    const baseline = JSON.stringify(
      engine.scanTimeline(frames, { runId: fixture.runId }),
    );

    for (let repetition = 0; repetition < 100; repetition += 1) {
      expect(
        JSON.stringify(
          engine.scanTimeline(frames, { runId: fixture.runId }),
        ),
      ).toBe(baseline);
    }
  });
});
