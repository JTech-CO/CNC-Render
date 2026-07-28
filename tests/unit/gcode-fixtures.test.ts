import { describe, expect, it } from "vitest";

import {
  loadGcodeFixtureManifests,
  parseGcodeFixture,
  projectToolpathForGolden,
  unwrapGcodeResult,
} from "../helpers/gcode-cli.mjs";

const manifests = loadGcodeFixtureManifests();

function expectFiniteVector(
  actual: Record<string, number>,
  expected: Record<string, number>,
  tolerance: number,
) {
  for (const coordinate of ["xMm", "yMm", "zMm"]) {
    expect(Number.isFinite(actual[coordinate])).toBe(true);
    expect(Math.abs(actual[coordinate] - expected[coordinate])).toBeLessThanOrEqual(
      tolerance,
    );
  }
}

function expectPartialValue(
  actual: unknown,
  expected: unknown,
  numericTolerance: number,
) {
  if (typeof expected === "number") {
    expect(typeof actual).toBe("number");
    expect(Number.isFinite(actual as number)).toBe(true);
    expect(Math.abs((actual as number) - expected)).toBeLessThanOrEqual(
      numericTolerance,
    );
    return;
  }

  if (Array.isArray(expected)) {
    expect(Array.isArray(actual)).toBe(true);
    expect(actual).toHaveLength(expected.length);
    for (const [index, expectedValue] of expected.entries()) {
      expectPartialValue(
        (actual as unknown[])[index],
        expectedValue,
        numericTolerance,
      );
    }
    return;
  }

  if (typeof expected === "object" && expected !== null) {
    expect(typeof actual).toBe("object");
    expect(actual).not.toBeNull();
    for (const [key, expectedValue] of Object.entries(expected)) {
      expectPartialValue(
        (actual as Record<string, unknown>)[key],
        expectedValue,
        numericTolerance,
      );
    }
    return;
  }

  expect(actual).toEqual(expected);
}

function diagnosticProjection(diagnostics: Array<Record<string, unknown>>) {
  return diagnostics.map(
    ({ code, line, column, severity, recoverable }) => ({
      code,
      line,
      column,
      severity,
      recoverable,
    }),
  );
}

describe("gcode golden fixtures", () => {
  it.each(manifests)(
    "gcode parses $fixtureId with the documented geometry and diagnostics",
    (manifest) => {
      const response = parseGcodeFixture(manifest);
      const result = unwrapGcodeResult(response);

      expect(result.accepted).toBe(manifest.expected.accepted);
      expect(diagnosticProjection(result.diagnostics)).toEqual(
        manifest.expected.diagnostics,
      );
      expectFiniteVector(
        result.endpointMm,
        manifest.expected.endMm,
        manifest.tolerance.positionMm,
      );

      for (const component of ["total", "rapid", "feed"]) {
        expect(Number.isFinite(result.pathLengthMm[component])).toBe(true);
        expect(
          Math.abs(
            result.pathLengthMm[component] -
              manifest.expected.pathLengthMm[component],
          ),
        ).toBeLessThanOrEqual(manifest.tolerance.pathLengthMm);
      }

      if (manifest.expected.finalState !== undefined) {
        expect(result.finalState).toMatchObject(manifest.expected.finalState);
      }
      if (manifest.expected.programControlEvents !== undefined) {
        expect(result.programControlEvents).toEqual(
          manifest.expected.programControlEvents,
        );
      }

      if (manifest.expected.accepted) {
        expect(result.toolpath).not.toBeNull();
        const projection = projectToolpathForGolden(result.toolpath);
        expect(projection.segmentTypes).toEqual(
          manifest.expected.segmentTypes,
        );
        expect(projection.sourceMap).toEqual(manifest.expected.sourceMap);
        expect(result.toolpath.sourceLineMap).toHaveLength(
          result.toolpath.segments.length,
        );

        const numericTolerance = Math.max(
          manifest.tolerance.positionMm,
          manifest.tolerance.pathLengthMm,
        );
        for (const detail of manifest.expected.segmentDetails ?? []) {
          const { segmentIndex, ...expectedSegment } = detail;
          expect(Number.isSafeInteger(segmentIndex)).toBe(true);
          expect(segmentIndex).toBeGreaterThanOrEqual(0);
          expect(segmentIndex).toBeLessThan(result.toolpath.segments.length);
          expectPartialValue(
            result.toolpath.segments[segmentIndex],
            expectedSegment,
            numericTolerance,
          );
        }
      } else {
        expect(result.toolpath).toBeNull();
        expect(result.canonicalMotions).toEqual([]);
        expect(result.programControlEvents ?? []).toEqual([]);
      }
    },
    120_000,
  );
});
