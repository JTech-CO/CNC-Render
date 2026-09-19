import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { DiagnosticMarkers } from "../../packages/renderer/src/diagnostic-markers";

const { Group, PerspectiveCamera, Raycaster, Vector2, Vector3 } = createRequire(
  new URL("../../packages/renderer/package.json", import.meta.url),
)("three");

describe("M11 spatial diagnostic markers", () => {
  it("preserves engine IDs, canonical mm mapping and selection without animation", () => {
    const markers = new DiagnosticMarkers();
    markers.set([{ id: "collision-a", positionMm: { xMm: 12, yMm: 23, zMm: 34 } }], "collision-a");
    expect(markers.position("collision-a")?.toArray()).toEqual([12, 34, -23]);
    expect(markers.group.children[0]?.scale.x).toBe(1.5);
    markers.set([]);
    expect(markers.position("collision-a")).toBeNull();
    markers.dispose();
  });
  it("rejects invalid coordinates and duplicate IDs atomically", () => {
    const markers = new DiagnosticMarkers();
    const marker = { id: "axis-limit", positionMm: { xMm: 0, yMm: 0, zMm: 1 } };
    markers.set([marker]);
    expect(() => markers.set([marker, marker])).toThrow(RangeError);
    expect(() => markers.set([{ ...marker, positionMm: { xMm: NaN, yMm: 0, zMm: 0 } }])).toThrow(RangeError);
    expect(markers.group.children).toHaveLength(1);
    markers.dispose();
  });

  it("rejects missing/extra coordinate keys and unsafe identities without replacing valid markers", () => {
    const markers = new DiagnosticMarkers();
    markers.set([{ id: "valid", positionMm: { xMm: 0, yMm: 0, zMm: 0 } }]);
    for (const positionMm of [{ yMm: 0, zMm: 0 }, { xMm: 0, yMm: 0, zMm: 0, extra: 1 },
      Object.assign(Object.create({ xMm: 0 }), { yMm: 0, zMm: 0, extra: 1 })]) {
      expect(() => markers.set([{ id: "invalid", positionMm } as unknown as Parameters<DiagnosticMarkers["set"]>[0][number]])).toThrow(RangeError);
    }
    for (const id of ["", "bad\nkey", "a".repeat(257)]) {
      expect(() => markers.set([{ id, positionMm: { xMm: 0, yMm: 0, zMm: 0 } }])).toThrow(RangeError);
    }
    expect(markers.position("valid")?.toArray()).toEqual([0, 0, 0]);
    markers.dispose();
  });

  it("uses fresh world transforms and maps the projected center back to a real mesh raycast", () => {
    const markers = new DiagnosticMarkers();
    markers.set([{ id: "runtime-ray", positionMm: { xMm: 0, yMm: 0, zMm: 0 } }]);
    const parent = new Group(); parent.add(markers.group); parent.position.set(4, 8, 12);
    expect(markers.position("runtime-ray")?.toArray()).toEqual([4, 8, 12]);
    const camera = new PerspectiveCamera(38, 2, 1, 1000);
    camera.position.set(4, 8, 112); camera.lookAt(new Vector3(4, 8, 12));
    const bounds = { left: 20, top: 40, width: 200, height: 100 };
    expect(markers.screenPosition("runtime-ray", camera, bounds)).toEqual([120, 90]);
    const ray = new Raycaster(); ray.setFromCamera(new Vector2(0, 0), camera);
    expect(ray.intersectObjects(markers.group.children, false)[0]?.object.userData.diagnosticId).toBe("runtime-ray");
    parent.position.x = 14;
    expect(markers.position("runtime-ray")?.toArray()).toEqual([14, 8, 12]);
    expect(markers.screenPosition("runtime-ray", camera, bounds)?.[0]).toBeGreaterThan(120);
    markers.dispose();
  });

  it("never advertises clipped, nonfinite, zero-sized or browser-offscreen marker clicks", () => {
    const markers = new DiagnosticMarkers();
    const camera = new PerspectiveCamera(38, 2, 1, 100);
    camera.position.set(0, 0, 10); camera.lookAt(0, 0, 0);
    const bounds = { left: 0, top: 0, width: 200, height: 100 };
    for (const positionMm of [{ xMm: 0, yMm: -20, zMm: 0 }, { xMm: 0, yMm: -9.5, zMm: 0 },
      { xMm: 0, yMm: 110, zMm: 0 }, { xMm: 50, yMm: 0, zMm: 0 }]) {
      markers.set([{ id: "clipped", positionMm }]);
      expect(markers.screenPosition("clipped", camera, bounds)).toBeNull();
    }
    markers.set([{ id: "center", positionMm: { xMm: 0, yMm: 0, zMm: 0 } }]);
    expect(markers.screenPosition("missing", camera, bounds)).toBeNull();
    expect(markers.screenPosition("center", camera, { ...bounds, width: 0 })).toBeNull();
    expect(markers.screenPosition("center", camera, { ...bounds, top: NaN })).toBeNull();
    expect(markers.screenPosition("center", camera, { ...bounds, top: 100, height: 1800 }, { width: 1440, height: 900 })).toBeNull();
    expect(markers.screenPosition("center", camera, bounds, { width: 1440, height: 900 })).toEqual([100, 50]);
    markers.dispose();
  });
});
