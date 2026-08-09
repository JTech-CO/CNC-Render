import { describe, expect, it } from "vitest";
import {
  LatheRadiusFieldEngine,
  TurningInputError,
  type TurningQualityPreset,
} from "../../packages/simulation/src/material-removal-turning";
import {
  createTurningOptions,
  expectedTurningProfile,
  loadTurningGoldenFixture,
  runTurningGoldenItem,
} from "../helpers/turning-fixture";

const fixture = loadTurningGoldenFixture();
const presets = ["preview", "balanced", "precision"] as const;

describe("M6 turning radius-field material removal", () => {
  it("matches every analytic facing, OD, taper, groove, parting, drilling, and boring profile", () => {
    for (const item of fixture.fixtures) {
      for (const preset of presets) {
        const engine = runTurningGoldenItem(fixture, item, preset);
        const snapshot = engine.serializeProfile();
        for (let cellIndex = 0; cellIndex < snapshot.axialCells; cellIndex += 1) {
          const startZMm = snapshot.minimumZMm + cellIndex * snapshot.resolutionMm;
          const endZMm = Math.min(
            snapshot.maximumZMm,
            startZMm + snapshot.resolutionMm,
          );
          const zMm = (startZMm + endZMm) / 2;
          const actual = engine.profileAt(zMm);
          const expected = expectedTurningProfile(fixture, item, actual.centerZMm);
          expect(actual.outerRadiusMm).toBeLessThanOrEqual(
            expected.outerRadiusMm + 1e-9,
          );
          expect(expected.outerRadiusMm - actual.outerRadiusMm).toBeLessThanOrEqual(
            actual.representationResolutionMm + 1e-9,
          );
          expect(actual.innerRadiusMm).toBeGreaterThanOrEqual(
            expected.innerRadiusMm - 1e-9,
          );
          expect(actual.innerRadiusMm - expected.innerRadiusMm).toBeLessThanOrEqual(
            actual.representationResolutionMm + 1e-9,
          );
          expect(actual.innerRadiusMm).toBeLessThanOrEqual(actual.outerRadiusMm);
        }
      }
    }
  });

  it("keeps OD radial error within one radius-field cell for every preset", () => {
    const item = fixture.fixtures.find(({ operation }) => operation === "od-turning")!;
    for (const preset of presets) {
      const engine = runTurningGoldenItem(fixture, item, preset);
      const measurement = engine.measureOuterDiameter(10);
      const radiusErrorMm = Math.abs(measurement.valueMm / 2 - 30);
      expect(radiusErrorMm).toBeLessThanOrEqual(
        measurement.representationResolutionMm,
      );
    }
  });

  it("never grows material and makes repeated or milder cuts exact no-ops", async () => {
    const external = fixture.fixtures.find(({ operation }) => operation === "od-turning")!;
    const engine = runTurningGoldenItem(fixture, external, "balanced");
    const hash = await engine.profileHashSha256();
    const volume = engine.removedVolumeMm3;
    expect(engine.applyCut(external.cut)).toMatchObject({
      updatedCells: 0,
      removedVolumeDeltaMm3: 0,
      removedVolumeMm3: volume,
    });
    expect(await engine.profileHashSha256()).toBe(hash);
    expect(
      engine.applyCut({
        operation: "od-turning",
        startZMm: -20,
        endZMm: 50,
        startOuterRadiusMm: 35,
        endOuterRadiusMm: 35,
      }),
    ).toMatchObject({ updatedCells: 0, removedVolumeDeltaMm3: 0 });

    const boring = fixture.fixtures.find(({ operation }) => operation === "boring")!;
    const inner = runTurningGoldenItem(fixture, boring, "balanced");
    const innerVolume = inner.removedVolumeMm3;
    expect(inner.applyCut(boring.cut)).toMatchObject({ updatedCells: 0 });
    expect(
      inner.applyCut({
        operation: "boring",
        startZMm: -10,
        endZMm: 50,
        startInnerRadiusMm: 8,
        endInnerRadiusMm: 8,
      }),
    ).toMatchObject({ updatedCells: 0, removedVolumeMm3: innerVolume });
  });

  it("round-trips profile layers with identical hash and measurements", async () => {
    for (const operation of ["facing", "taper", "boring"] as const) {
      const item = fixture.fixtures.find((candidate) => candidate.operation === operation)!;
      const options = createTurningOptions(fixture, item, "balanced");
      const original = runTurningGoldenItem(fixture, item, "balanced");
      const snapshot = JSON.parse(
        JSON.stringify(original.serializeProfile()),
      ) as ReturnType<typeof original.serializeProfile>;
      const restored = LatheRadiusFieldEngine.restoreProfile(options, snapshot);
      expect(await restored.profileHashSha256()).toBe(
        await original.profileHashSha256(),
      );
      expect(restored.measureOuterDiameter(10)).toEqual(
        original.measureOuterDiameter(10),
      );
      expect(restored.measureInnerDiameter(10)).toEqual(
        original.measureInnerDiameter(10),
      );
      expect(restored.measureMaterialLength()).toEqual(
        original.measureMaterialLength(),
      );
    }
  });

  it("reports chuck and opposite-axis restricted-zone collisions", () => {
    const item = fixture.fixtures[1];
    const engine = new LatheRadiusFieldEngine(
      createTurningOptions(fixture, item, "balanced"),
    );
    expect(engine.detectRestrictedZoneCollision({ xMm: 20, zMm: 0 })).toBeNull();
    expect(engine.detectRestrictedZoneCollision({ xMm: -1, zMm: 0 })).toMatchObject({
      code: "turning.collision.axis-opposite-side",
      kind: "axis-opposite-side",
    });
    expect(engine.detectRestrictedZoneCollision({ xMm: 20, zMm: -50 })).toMatchObject({
      code: "turning.collision.chuck",
      kind: "chuck",
    });
  });

  it("emits only changed profile cells after the initial surface snapshot", () => {
    const item = fixture.fixtures.find(({ operation }) => operation === "groove")!;
    const engine = new LatheRadiusFieldEngine(
      createTurningOptions(fixture, item, "balanced"),
    );
    const full = engine.createFullSurfaceSnapshot(24);
    expect(full.outerRadiusMm).toHaveLength(full.axialCells);
    const result = engine.applyCut(item.cut);
    const patches = engine.drainDirtySurfacePatches();
    expect(patches).toHaveLength(1);
    expect(patches[0].cellIndices).toHaveLength(result.updatedCells);
    expect(engine.drainDirtySurfacePatches()).toEqual([]);
    expect(engine.getDiagnostics()).toMatchObject({
      fullSurfaceExtractions: 1,
      partialSurfaceExtractions: 1,
      dirtyCells: 0,
    });
  });

  it("fails closed for incompatible tools, malformed cuts, and invalid snapshots", () => {
    const drilling = fixture.fixtures.find(({ operation }) => operation === "drilling")!;
    const turning = fixture.fixtures.find(({ operation }) => operation === "od-turning")!;
    const wrongTool = new LatheRadiusFieldEngine(
      createTurningOptions(fixture, turning, "balanced"),
    );
    expect(() => wrongTool.applyCut(drilling.cut)).toThrowError(TurningInputError);
    expect(() =>
      wrongTool.applyCut({
        operation: "taper",
        startZMm: 10,
        endZMm: -10,
        startOuterRadiusMm: 30,
        endOuterRadiusMm: 20,
      }),
    ).toThrowError(/startZMm <= endZMm/u);
    const snapshot = wrongTool.serializeProfile();
    expect(() =>
      LatheRadiusFieldEngine.restoreProfile(
        createTurningOptions(fixture, turning, "preview"),
        snapshot,
      ),
    ).toThrowError(/does not match/u);
  });

  it("produces the same profile hash for 100 fresh deterministic runs", async () => {
    const item = fixture.fixtures.find(({ operation }) => operation === "taper")!;
    const hashes = new Set<string>();
    for (let index = 0; index < 100; index += 1) {
      hashes.add(await runTurningGoldenItem(fixture, item, "balanced").profileHashSha256());
    }
    expect(hashes.size).toBe(1);
    expect([...hashes][0]).toMatch(/^[a-f0-9]{64}$/u);
  });
});

void ("balanced" satisfies TurningQualityPreset);
