import { createMachineScene } from "../../packages/renderer/src/machine-scene";
import { describe, expect, it } from "vitest";

describe("machine scene dynamic Stock replacement", () => {
  it("hides the static Stock and its outline behind the dynamic surface", () => {
    const machineScene = createMachineScene();
    const stockLayer = machineScene.layerGroups.get("stock");
    const educationStock = stockLayer?.getObjectByName("education-stock");
    const educationOutline = stockLayer?.getObjectByName(
      "education-stock-outline",
    );

    expect(educationStock).toBeDefined();
    expect(educationOutline?.parent).toBe(educationStock);

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

    expect(educationStock?.visible).toBe(false);
    expect(machineScene.getStockSurfaceDiagnostics()).toMatchObject({
      cells: 1,
      fullBufferUploads: 1,
      partialBufferUpdates: 0,
    });
    machineScene.dispose();
  });
});
