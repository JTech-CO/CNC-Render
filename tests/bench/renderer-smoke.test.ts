import { performance } from "node:perf_hooks";
import { describe, expect, it } from "vitest";
import {
  projectAxisAlignedBounds,
  type AxisAlignedBounds,
} from "@cnc-render/renderer";

const projectionMatrix = [
  1.4005180264859172,
  -0.798370066705744,
  -0.6335193610004586,
  -0.6333926697973787,
  0,
  2.664113678581577,
  -0.3982121697717169,
  -0.3981325353012096,
  -1.336858116191103,
  -0.8363876889298271,
  -0.6636869496195281,
  -0.6635542255020159,
  0,
  -426.2581885730526,
  1719.7847528247685,
  1721.4406302864572,
] as const;
const bounds: AxisAlignedBounds = {
  min: [-650, 0, -500],
  max: [650, 1_400, 500],
};

describe("renderer-smoke", () => {
  it("projects 20,000 scene bounds inside the renderer smoke budget", () => {
    for (let index = 0; index < 1_000; index += 1) {
      projectAxisAlignedBounds(projectionMatrix, bounds, 1_200, 800);
    }

    const start = performance.now();
    let checksum = 0;
    for (let index = 0; index < 20_000; index += 1) {
      const projected = projectAxisAlignedBounds(
        projectionMatrix,
        bounds,
        1_200,
        800,
      );
      checksum += projected.maxX - projected.minX;
    }
    const elapsedMs = performance.now() - start;

    expect(Number.isFinite(checksum)).toBe(true);
    expect(elapsedMs).toBeLessThan(750);
  });
});
