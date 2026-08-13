import { createMachineScene } from "../../packages/renderer/src/machine-scene";
import { describe, expect, it } from "vitest";

describe("machine scene process presentation", () => {
  it("uses turning geometry and converts controller diameter X to radius", () => {
    const machineScene = createMachineScene();

    try {
      expect(machineScene.presentationMode).toBe("milling");

      machineScene.configureRotationalStockSurface({
        axisCenterMm: { xMm: 0, yMm: 0 },
        minimumZMm: 240,
        maximumZMm: 360,
        axialCells: 2,
        radialSegments: 8,
        resolutionMm: 60,
        innerRadiusMm: new Float32Array([0, 0]),
        outerRadiusMm: new Float32Array([40, 40]),
      });
      machineScene.setToolPositionMm([80, 0, 350]);

      const millingCutter = machineScene.scene.getObjectByName(
        "presentation:milling:cutter",
      );
      const turningCutter = machineScene.scene.getObjectByName(
        "presentation:turning:cutter",
      );
      const cutterLayer = machineScene.layerGroups.get("cutter");

      expect(machineScene.presentationMode).toBe("turning");
      expect(millingCutter?.visible).toBe(false);
      expect(turningCutter?.visible).toBe(true);
      expect(cutterLayer?.position.x).toBe(40);
      expect(cutterLayer?.position.y).toBe(350);
      expect(cutterLayer?.position.z).toBeCloseTo(0);

      machineScene.configureStockSurface({
        boundsMm: {
          minimum: { xMm: -2, yMm: -2, zMm: 0 },
          maximum: { xMm: 2, yMm: 2, zMm: 4 },
        },
        columns: 1,
        rows: 1,
        resolutionMm: 4,
        topZMm: new Float32Array([4]),
      });

      expect(machineScene.presentationMode).toBe("milling");
      expect(millingCutter?.visible).toBe(true);
      expect(turningCutter?.visible).toBe(false);
    } finally {
      machineScene.dispose();
    }
  });
});
