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
