import { Group, Mesh, MeshBasicMaterial, OctahedronGeometry, Vector3, type PerspectiveCamera } from "three";
import { domainMmToScene } from "./coordinate-space";

export interface SpatialDiagnosticMarker {
  readonly id: string;
  readonly positionMm: { readonly xMm: number; readonly yMm: number; readonly zMm: number };
}

export interface DiagnosticViewportBounds {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/** Renderer-owned geometry. IDs refer to engine diagnostics, never UI-generated locations. */
export class DiagnosticMarkers {
  readonly group = new Group();
  readonly #geometry = new OctahedronGeometry(5);
  readonly #material = new MeshBasicMaterial({ color: 0xb42318, depthTest: false });

  set(markers: readonly SpatialDiagnosticMarker[], selectedId: string | null = null): void {
    if (markers.length > 256 || new Set(markers.map(({ id }) => id)).size !== markers.length) {
      throw new RangeError("Diagnostic markers must have unique IDs and at most 256 positions.");
    }
    for (const marker of markers) {
      const coordinates = marker.positionMm;
      if (typeof marker.id !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,255}$/.test(marker.id)
        || !coordinates || typeof coordinates !== "object" || Array.isArray(coordinates)
        || Object.keys(coordinates).length !== 3
        || !["xMm", "yMm", "zMm"].every((key) => Object.hasOwn(coordinates, key))
        || ![coordinates.xMm, coordinates.yMm, coordinates.zMm].every(Number.isFinite)) {
        throw new RangeError("Diagnostic marker coordinates must be finite millimetres.");
      }
    }
    this.group.clear();
    for (const marker of markers) {
      const mesh = new Mesh(this.#geometry, this.#material);
      mesh.name = `diagnostic-${marker.id}`;
      mesh.userData.diagnosticId = marker.id;
      mesh.position.set(...domainMmToScene([
        marker.positionMm.xMm, marker.positionMm.yMm, marker.positionMm.zMm,
      ]));
      mesh.scale.setScalar(marker.id === selectedId ? 1.5 : 1);
      mesh.renderOrder = 30;
      this.group.add(mesh);
    }
    this.group.updateMatrixWorld(true);
  }

  position(id: string): Vector3 | null {
    return this.group.children.find((child) => child.userData.diagnosticId === id)?.getWorldPosition(new Vector3()) ?? null;
  }

  screenPosition(id: string, camera: PerspectiveCamera, bounds: DiagnosticViewportBounds,
    visibleViewport?: { readonly width: number; readonly height: number }): readonly [number, number] | null {
    if (![bounds.left, bounds.top, bounds.width, bounds.height].every(Number.isFinite)
      || bounds.width <= 0 || bounds.height <= 0
      || (visibleViewport && (![visibleViewport.width, visibleViewport.height].every(Number.isFinite)
        || visibleViewport.width <= 0 || visibleViewport.height <= 0))) return null;
    const point = this.position(id);
    if (!point) return null;
    camera.updateWorldMatrix(true, false);
    const cameraSpace = point.clone().applyMatrix4(camera.matrixWorldInverse);
    if (!Number.isFinite(cameraSpace.z) || cameraSpace.z > -camera.near || cameraSpace.z < -camera.far) return null;
    point.project(camera);
    if (![point.x, point.y, point.z].every(Number.isFinite) || Math.abs(point.x) > 1 || Math.abs(point.y) > 1) return null;
    const x = bounds.left + (point.x + 1) * bounds.width / 2;
    const y = bounds.top + (1 - point.y) * bounds.height / 2;
    if (!Number.isFinite(x) || !Number.isFinite(y)
      || (visibleViewport && (x < 0 || y < 0 || x >= visibleViewport.width || y >= visibleViewport.height))) return null;
    return [x, y];
  }

  dispose(): void {
    this.group.removeFromParent();
    this.group.clear();
    this.#geometry.dispose();
    this.#material.dispose();
  }
}
