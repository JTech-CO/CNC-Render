import { describe, expect, it } from "vitest";

import { createMachineScene } from "../../packages/renderer/src/machine-scene";

describe("M4 collision renderer marker", () => {
  it("renders a separate finite 3D collision-location marker", () => {
    const machineScene = createMachineScene();
    try {
      const marker = machineScene.scene.getObjectByName(
        "collision-location-marker",
      );
      expect(marker).toBeDefined();
      expect(marker?.visible).toBe(false);

      machineScene.setCollisionMarker([12, 34, 56]);
      expect(marker?.visible).toBe(true);
      expect(marker?.position.toArray()).toEqual([12, 56, -34]);
      expect(marker?.userData.selectable).toBe(false);
      expect(marker?.name).not.toBe("collision-proxy");

      machineScene.setCollisionMarker(null);
      expect(marker?.visible).toBe(false);
    } finally {
      machineScene.dispose();
    }
  });
});

describe("M9 simulation tool motion bridge", () => {
  it("moves holder and cutter layers from the documented 340 mm tool-tip home", () => {
    const machineScene = createMachineScene();
    try {
      const holder = machineScene.layerGroups.get("holder");
      const cutter = machineScene.layerGroups.get("cutter");
      expect(holder?.position.toArray()).toEqual([0, 0, 0]);
      expect(cutter?.position.toArray()).toEqual([0, 0, 0]);

      machineScene.setToolPositionMm([12, -5, 340]);
      expect(holder?.position.toArray()).toEqual([12, 0, 5]);
      expect(cutter?.position.toArray()).toEqual([12, 0, 5]);

      machineScene.setToolPositionMm([-8, 4, 300]);
      expect(holder?.position.toArray()).toEqual([-8, -40, -4]);
      expect(cutter?.position.toArray()).toEqual([-8, -40, -4]);
    } finally {
      machineScene.dispose();
    }
  });
});
