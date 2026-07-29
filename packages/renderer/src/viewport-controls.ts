import {
  Spherical,
  Vector2,
  Vector3,
  type PerspectiveCamera,
} from "three";

type ChangeListener = () => void;
type PointerMode = "orbit" | "pan";

/**
 * Renderer-owned pointer controls. Right drag orbits, middle drag pans and the
 * wheel zooms; left click remains available for semantic object selection.
 */
export class ViewportControls {
  readonly target = new Vector3();
  minDistance = 180;
  maxDistance = 5_000;

  readonly #camera: PerspectiveCamera;
  readonly #element: HTMLCanvasElement;
  readonly #listeners = new Set<ChangeListener>();
  readonly #lastPointer = new Vector2();
  #pointerMode: PointerMode | null = null;
  #activePointerId: number | null = null;

  constructor(camera: PerspectiveCamera, element: HTMLCanvasElement) {
    this.#camera = camera;
    this.#element = element;
    element.addEventListener("pointerdown", this.#handlePointerDown);
    element.addEventListener("wheel", this.#handleWheel, { passive: false });
  }

  addEventListener(type: "change", listener: ChangeListener): void {
    if (type === "change") {
      this.#listeners.add(listener);
    }
  }

  removeEventListener(type: "change", listener: ChangeListener): void {
    if (type === "change") {
      this.#listeners.delete(listener);
    }
  }

  update(): void {
    this.#camera.lookAt(this.target);
    this.#camera.updateMatrixWorld(true);
    this.#emitChange();
  }

  dispose(): void {
    this.#element.removeEventListener("pointerdown", this.#handlePointerDown);
    this.#element.removeEventListener("wheel", this.#handleWheel);
    window.removeEventListener("pointermove", this.#handlePointerMove);
    window.removeEventListener("pointerup", this.#handlePointerUp);
    window.removeEventListener("pointercancel", this.#handlePointerUp);
    this.#listeners.clear();
  }

  #emitChange(): void {
    for (const listener of this.#listeners) {
      listener();
    }
  }

  #handlePointerDown = (event: PointerEvent): void => {
    const mode =
      event.button === 2 ? "orbit" : event.button === 1 ? "pan" : null;
    if (!mode) {
      return;
    }

    event.preventDefault();
    this.#element.focus({ preventScroll: true });
    this.#pointerMode = mode;
    this.#activePointerId = event.pointerId;
    this.#lastPointer.set(event.clientX, event.clientY);
    window.addEventListener("pointermove", this.#handlePointerMove);
    window.addEventListener("pointerup", this.#handlePointerUp);
    window.addEventListener("pointercancel", this.#handlePointerUp);
  };

  #handlePointerMove = (event: PointerEvent): void => {
    if (
      this.#pointerMode === null ||
      event.pointerId !== this.#activePointerId
    ) {
      return;
    }

    const deltaX = event.clientX - this.#lastPointer.x;
    const deltaY = event.clientY - this.#lastPointer.y;
    this.#lastPointer.set(event.clientX, event.clientY);

    if (this.#pointerMode === "orbit") {
      this.#orbit(deltaX, deltaY);
    } else {
      this.#pan(deltaX, deltaY);
    }
    this.update();
  };

  #handlePointerUp = (event: PointerEvent): void => {
    if (event.pointerId !== this.#activePointerId) {
      return;
    }

    this.#pointerMode = null;
    this.#activePointerId = null;
    window.removeEventListener("pointermove", this.#handlePointerMove);
    window.removeEventListener("pointerup", this.#handlePointerUp);
    window.removeEventListener("pointercancel", this.#handlePointerUp);
  };

  #handleWheel = (event: WheelEvent): void => {
    event.preventDefault();
    const factor = Math.exp(event.deltaY * 0.0012);
    const offset = this.#camera.position.clone().sub(this.target);
    const distance = Math.min(
      this.maxDistance,
      Math.max(this.minDistance, offset.length() * factor),
    );
    offset.setLength(distance);
    this.#camera.position.copy(this.target).add(offset);
    this.update();
  };

  #orbit(deltaX: number, deltaY: number): void {
    const offset = this.#camera.position.clone().sub(this.target);
    const spherical = new Spherical().setFromVector3(offset);
    spherical.theta -= deltaX * 0.006;
    spherical.phi = Math.min(
      Math.PI - 0.04,
      Math.max(0.04, spherical.phi - deltaY * 0.006),
    );
    offset.setFromSpherical(spherical);
    this.#camera.position.copy(this.target).add(offset);
  }

  #pan(deltaX: number, deltaY: number): void {
    const viewportHeight = Math.max(this.#element.clientHeight, 1);
    const distance = this.#camera.position.distanceTo(this.target);
    const worldPerPixel =
      (2 *
        distance *
        Math.tan((this.#camera.fov * Math.PI) / 360)) /
      viewportHeight;
    const right = new Vector3().setFromMatrixColumn(this.#camera.matrix, 0);
    const up = new Vector3().setFromMatrixColumn(this.#camera.matrix, 1);
    const translation = right
      .multiplyScalar(-deltaX * worldPerPixel)
      .add(up.multiplyScalar(deltaY * worldPerPixel));
    this.#camera.position.add(translation);
    this.target.add(translation);
  }
}
