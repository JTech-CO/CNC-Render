import {
  ACESFilmicToneMapping,
  Box3,
  PerspectiveCamera,
  Raycaster,
  SRGBColorSpace,
  Spherical,
  Vector2,
  Vector3,
  WebGLRenderer,
  type Camera,
  type Object3D,
  type Scene,
} from "three";
import {
  CAMERA_PRESETS,
  type CameraPresetId,
  type RendererBackendSelection,
  type RendererCapabilityProbe,
  type RendererMode,
  type RendererPreference,
  type RendererResourceSnapshot,
  type RendererTelemetry,
  type SceneLayerId,
} from "./contracts";
import {
  detectBrowserRendererCapabilities,
  selectRendererBackend,
} from "./capabilities";
import { domainMmToScene } from "./coordinate-space";
import {
  createMachineScene,
  DEFAULT_VIEWPORT_BACKGROUND,
  type MachineScene,
} from "./machine-scene";
import type {
  StockSurfaceBufferDiagnostics,
  StockSurfaceDescriptor,
  StockSurfacePatch,
} from "./stock-surface";
import { ViewportControls } from "./viewport-controls";

type RenderResult = Promise<void> | void;

interface RendererInfoLike {
  memory?: {
    geometries?: number;
    textures?: number;
  };
  programs?: readonly unknown[] | null;
}

interface RendererLike {
  readonly info?: RendererInfoLike;
  outputColorSpace: string;
  toneMapping: number;
  toneMappingExposure: number;
  setPixelRatio(value: number): void;
  setSize(width: number, height: number, updateStyle?: boolean): void;
  setClearColor(color: string | number, alpha?: number): void;
  render(scene: Scene, camera: Camera): RenderResult;
  dispose(): void;
}

export type CameraViewId = CameraPresetId | "custom";

export interface WorkcellRendererStatus {
  readonly capabilities: RendererCapabilityProbe;
  readonly backend: RendererBackendSelection;
  readonly runtimeWarning: string | null;
  readonly cameraView: CameraViewId;
  readonly selectedLayer: SceneLayerId | null;
  readonly focusRangeMm: {
    readonly minimum: number;
    readonly maximum: number;
  };
}

export interface WorkcellCameraSnapshot {
  readonly view: CameraViewId;
  readonly distanceMm: number;
  readonly positionMm: readonly [number, number, number];
  readonly targetMm: readonly [number, number, number];
}

export interface WorkcellRendererOptions {
  readonly canvas: HTMLCanvasElement;
  readonly preference?: RendererPreference;
  readonly pixelRatio?: number;
  readonly onStatus?: (status: WorkcellRendererStatus) => void;
  readonly onTelemetry?: (telemetry: RendererTelemetry) => void;
}

export interface WorkcellRendererDiagnostics {
  readonly status: WorkcellRendererStatus;
  readonly telemetry: RendererTelemetry;
  readonly camera: WorkcellCameraSnapshot;
  readonly collisionMarkerMm: readonly [number, number, number] | null;
  readonly stockSurface: StockSurfaceBufferDiagnostics | null;
}

const MINIMUM_FOCUS_DISTANCE_MM = 180;
const MAXIMUM_FOCUS_DISTANCE_MM = 5_000;
const CAMERA_FIELD_OF_VIEW_DEGREES = 38;
const CAMERA_NEAR_MM = 1;
const CAMERA_FAR_MM = 10_000;

function sceneToDomainMm(vector: Vector3): readonly [number, number, number] {
  return [vector.x, -vector.z, vector.y];
}

function finite(value: number, fallback = 0): number {
  return Number.isFinite(value) ? value : fallback;
}

function rendererResourceSnapshot(
  renderer: RendererLike,
  machineScene: MachineScene,
): RendererResourceSnapshot {
  const rendererMemory = renderer.info?.memory;
  const geometryIds = new Set<number>();
  machineScene.scene.traverse((object) => {
    const objectWithGeometry = object as Object3D & {
      geometry?: { id: number };
    };
    if (objectWithGeometry.geometry) {
      geometryIds.add(objectWithGeometry.geometry.id);
    }
  });

  return {
    geometries: Math.max(
      finite(rendererMemory?.geometries ?? 0),
      geometryIds.size,
    ),
    textures: finite(rendererMemory?.textures ?? 0),
    programs: finite(renderer.info?.programs?.length ?? 0),
  };
}

export class WorkcellRenderer {
  readonly #canvas: HTMLCanvasElement;
  readonly #preference: RendererPreference;
  readonly #pixelRatio: number;
  readonly #onStatus?: (status: WorkcellRendererStatus) => void;
  readonly #onTelemetry?: (telemetry: RendererTelemetry) => void;
  readonly #camera = new PerspectiveCamera(
    CAMERA_FIELD_OF_VIEW_DEGREES,
    1,
    CAMERA_NEAR_MM,
    CAMERA_FAR_MM,
  );
  readonly #raycaster = new Raycaster();
  readonly #pointer = new Vector2();
  readonly #frameDurations: number[] = [];
  readonly #pointerStart = new Vector2();

  #machineScene: MachineScene | null = null;
  #renderer: RendererLike | null = null;
  #controls: ViewportControls | null = null;
  #capabilities: RendererCapabilityProbe | null = null;
  #backend: RendererBackendSelection | null = null;
  #runtimeWarning: string | null = null;
  #cameraView: CameraViewId = "isometric";
  #selectedLayer: SceneLayerId | null = null;
  #framesRendered = 0;
  #frameRequest: number | null = null;
  #renderInFlight = false;
  #dirty = false;
  #disposed = false;
  #pointerMoved = false;
  #collisionMarkerMm: readonly [number, number, number] | null = null;

  constructor(options: WorkcellRendererOptions) {
    this.#canvas = options.canvas;
    this.#preference = options.preference ?? "auto";
    this.#pixelRatio = Math.min(
      1.5,
      Math.max(1, options.pixelRatio ?? window.devicePixelRatio ?? 1),
    );
    this.#onStatus = options.onStatus;
    this.#onTelemetry = options.onTelemetry;
  }

  async initialize(): Promise<WorkcellRendererStatus> {
    if (this.#disposed) {
      throw new Error("Cannot initialize a disposed workcell renderer.");
    }

    this.#capabilities = detectBrowserRendererCapabilities();
    this.#backend = selectRendererBackend(
      this.#capabilities,
      this.#preference,
    );

    if (!this.#backend.mode) {
      const status = this.#status();
      this.#onStatus?.(status);
      throw new Error(
        "이 브라우저에서는 WebGPU와 WebGL 2 렌더링을 시작할 수 없습니다.",
      );
    }

    this.#machineScene = createMachineScene();
    this.#renderer = await this.#createRenderer(this.#backend.mode);
    this.#configureRenderer(this.#renderer);
    this.#configureCamera();
    this.#configureControls();
    this.#attachInput();
    this.setCameraPreset("isometric");
    this.resize(
      this.#canvas.clientWidth || 960,
      this.#canvas.clientHeight || 640,
    );
    this.invalidate();

    const status = this.#status();
    this.#onStatus?.(status);
    return status;
  }

  async #createRenderer(mode: RendererMode): Promise<RendererLike> {
    if (mode === "webgpu") {
      try {
        const { WebGPURenderer } = await import("three/webgpu");
        const renderer = new WebGPURenderer({
          canvas: this.#canvas,
          antialias: true,
          powerPreference: "high-performance",
        });
        await renderer.init();
        return renderer as RendererLike;
      } catch (error) {
        if (!this.#capabilities?.webgl2) {
          throw error;
        }

        this.#runtimeWarning =
          "WebGPU 장치 초기화에 실패해 WebGL 2 안전 모드로 전환했습니다.";
        this.#backend = selectRendererBackend(
          { ...this.#capabilities, webgpu: false },
          "auto",
        );
      }
    }

    return new WebGLRenderer({
      canvas: this.#canvas,
      antialias: true,
      alpha: false,
      powerPreference: "high-performance",
      preserveDrawingBuffer: true,
    });
  }

  #configureRenderer(renderer: RendererLike): void {
    renderer.setPixelRatio(this.#pixelRatio);
    renderer.outputColorSpace = SRGBColorSpace;
    renderer.toneMapping = ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1;
    renderer.setClearColor(DEFAULT_VIEWPORT_BACKGROUND, 1);

    const rendererWithShadows = renderer as RendererLike & {
      shadowMap?: { enabled: boolean };
    };
    if (rendererWithShadows.shadowMap) {
      rendererWithShadows.shadowMap.enabled = true;
    }
  }

  #configureCamera(): void {
    this.#camera.near = CAMERA_NEAR_MM;
    this.#camera.far = CAMERA_FAR_MM;
    this.#camera.up.set(0, 1, 0);
    this.#camera.updateProjectionMatrix();
  }

  #configureControls(): void {
    const controls = new ViewportControls(this.#camera, this.#canvas);
    controls.minDistance = MINIMUM_FOCUS_DISTANCE_MM;
    controls.maxDistance = MAXIMUM_FOCUS_DISTANCE_MM;
    controls.addEventListener("change", this.#handleControlsChange);
    this.#controls = controls;
  }

  #attachInput(): void {
    this.#canvas.addEventListener("contextmenu", this.#preventContextMenu);
    this.#canvas.addEventListener("pointerdown", this.#handlePointerDown);
    this.#canvas.addEventListener("pointermove", this.#handlePointerMove);
    this.#canvas.addEventListener("pointerup", this.#handlePointerUp);
    this.#canvas.addEventListener("keydown", this.#handleKeyDown);
  }

  #preventContextMenu = (event: Event): void => {
    event.preventDefault();
  };

  #handleControlsChange = (): void => {
    this.#cameraView = "custom";
    this.invalidate();
    this.#onStatus?.(this.#status());
  };

  #handlePointerDown = (event: PointerEvent): void => {
    if (event.button !== 0) {
      return;
    }
    this.#pointerStart.set(event.clientX, event.clientY);
    this.#pointerMoved = false;
  };

  #handlePointerMove = (event: PointerEvent): void => {
    if ((event.buttons & 1) === 0) {
      return;
    }
    if (
      this.#pointerStart.distanceTo(
        this.#pointer.set(event.clientX, event.clientY),
      ) > 4
    ) {
      this.#pointerMoved = true;
    }
  };

  #handlePointerUp = (event: PointerEvent): void => {
    if (event.button === 0 && !this.#pointerMoved) {
      this.selectAt(event.clientX, event.clientY);
    }
  };

  #handleKeyDown = (event: KeyboardEvent): void => {
    if (event.key === "f" || event.key === "F") {
      event.preventDefault();
      this.fit();
      return;
    }

    const presetByKey: Partial<Record<string, CameraPresetId>> = {
      "0": "isometric",
      "1": "front",
      "2": "top",
      "3": "right",
    };
    const preset = presetByKey[event.key];
    if (preset) {
      event.preventDefault();
      this.setCameraPreset(preset);
      return;
    }

    if (event.key === "Escape") {
      this.#machineScene?.select(null);
      this.#selectedLayer = null;
      this.invalidate();
      this.#onStatus?.(this.#status());
    }
  };

  setCameraPreset(presetId: CameraPresetId): void {
    const controls = this.#controls;
    if (!controls) {
      return;
    }

    const preset = CAMERA_PRESETS[presetId];
    const [positionX, positionY, positionZ] = domainMmToScene(
      preset.positionMm,
    );
    const [targetX, targetY, targetZ] = domainMmToScene(preset.targetMm);
    const [upX, upY, upZ] = domainMmToScene(preset.up);
    this.#camera.position.set(positionX, positionY, positionZ);
    this.#camera.up.set(upX, upY, upZ);
    controls.target.set(targetX, targetY, targetZ);
    this.#camera.lookAt(controls.target);
    this.#cameraView = presetId;
    controls.update();
    this.#cameraView = presetId;
    this.invalidate();
    this.#onStatus?.(this.#status());
  }

  fit(): void {
    if (!this.#machineScene) {
      return;
    }
    this.#fitBounds(this.#machineScene.fitBounds);
  }

  focusLayer(layerId: SceneLayerId): void {
    const group = this.#machineScene?.layerGroups.get(layerId);
    if (!group || !group.visible) {
      return;
    }
    this.#fitBounds(new Box3().setFromObject(group));
  }

  #fitBounds(bounds: Box3): void {
    const controls = this.#controls;
    if (!controls || bounds.isEmpty()) {
      return;
    }

    const size = bounds.getSize(new Vector3());
    const center = bounds.getCenter(new Vector3());
    const radius = Math.max(size.length() / 2, 1);
    const verticalFieldOfView = (this.#camera.fov * Math.PI) / 180;
    const distance = Math.min(
      MAXIMUM_FOCUS_DISTANCE_MM,
      Math.max(
        MINIMUM_FOCUS_DISTANCE_MM,
        (radius / Math.sin(verticalFieldOfView / 2)) * 1.08,
      ),
    );
    const direction = this.#camera.position
      .clone()
      .sub(controls.target)
      .normalize();

    controls.target.copy(center);
    this.#camera.position.copy(center).addScaledVector(direction, distance);
    this.#camera.near = Math.max(1, distance / 1_000);
    this.#camera.far = Math.max(CAMERA_FAR_MM, distance * 4);
    this.#camera.updateProjectionMatrix();
    this.#cameraView = "custom";
    controls.update();
    this.invalidate();
    this.#onStatus?.(this.#status());
  }

  orbitByDegrees(azimuthDegrees: number, polarDegrees: number): void {
    const controls = this.#controls;
    if (!controls) {
      return;
    }

    const offset = this.#camera.position.clone().sub(controls.target);
    const spherical = new Spherical().setFromVector3(offset);
    spherical.theta += (azimuthDegrees * Math.PI) / 180;
    spherical.phi = Math.min(
      Math.PI - 0.05,
      Math.max(0.05, spherical.phi + (polarDegrees * Math.PI) / 180),
    );
    offset.setFromSpherical(spherical);
    this.#camera.position.copy(controls.target).add(offset);
    this.#camera.lookAt(controls.target);
    this.#cameraView = "custom";
    controls.update();
    this.invalidate();
  }

  panByMm(horizontalMm: number, verticalMm: number): void {
    const controls = this.#controls;
    if (!controls) {
      return;
    }

    const right = new Vector3().setFromMatrixColumn(this.#camera.matrix, 0);
    const up = new Vector3().setFromMatrixColumn(this.#camera.matrix, 1);
    const translation = right
      .multiplyScalar(horizontalMm)
      .add(up.multiplyScalar(verticalMm));
    this.#camera.position.add(translation);
    controls.target.add(translation);
    this.#cameraView = "custom";
    controls.update();
    this.invalidate();
  }

  zoomBy(factor: number): void {
    const controls = this.#controls;
    if (!controls || !Number.isFinite(factor) || factor <= 0) {
      return;
    }

    const offset = this.#camera.position.clone().sub(controls.target);
    const distance = Math.min(
      MAXIMUM_FOCUS_DISTANCE_MM,
      Math.max(MINIMUM_FOCUS_DISTANCE_MM, offset.length() * factor),
    );
    offset.setLength(distance);
    this.#camera.position.copy(controls.target).add(offset);
    this.#cameraView = "custom";
    controls.update();
    this.invalidate();
  }

  setLayerVisibility(layerId: SceneLayerId, visible: boolean): void {
    const layer = this.#machineScene?.layerGroups.get(layerId);
    if (!layer) {
      return;
    }
    layer.visible = visible;

    if (!visible && this.#selectedLayer === layerId) {
      this.#machineScene?.select(null);
      this.#selectedLayer = null;
    }
    this.invalidate();
    this.#onStatus?.(this.#status());
  }

  configureStockSurface(
    descriptor: StockSurfaceDescriptor,
  ): StockSurfaceBufferDiagnostics {
    if (!this.#machineScene) {
      throw new Error(
        "Initialize the workcell renderer before configuring Stock.",
      );
    }
    const diagnostics =
      this.#machineScene.configureStockSurface(descriptor);
    this.invalidate();
    return diagnostics;
  }

  applyStockSurfacePatches(
    patches: readonly StockSurfacePatch[],
  ): StockSurfaceBufferDiagnostics {
    if (!this.#machineScene) {
      throw new Error(
        "Initialize the workcell renderer before updating Stock.",
      );
    }
    const diagnostics =
      this.#machineScene.applyStockSurfacePatches(patches);
    if (patches.length > 0) {
      this.invalidate();
    }
    return diagnostics;
  }

  setCollisionMarker(
    positionMm: readonly [number, number, number] | null,
  ): void {
    if (
      positionMm !== null &&
      (!Number.isFinite(positionMm[0]) ||
        !Number.isFinite(positionMm[1]) ||
        !Number.isFinite(positionMm[2]))
    ) {
      throw new RangeError(
        "Collision marker coordinates must contain finite millimetre values.",
      );
    }

    this.#collisionMarkerMm = positionMm === null ? null : [...positionMm];
    this.#machineScene?.setCollisionMarker(this.#collisionMarkerMm);
    this.invalidate();
  }

  selectAt(clientX: number, clientY: number): SceneLayerId | null {
    const machineScene = this.#machineScene;
    if (!machineScene) {
      return null;
    }

    const bounds = this.#canvas.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0) {
      return null;
    }

    this.#pointer.set(
      ((clientX - bounds.left) / bounds.width) * 2 - 1,
      -((clientY - bounds.top) / bounds.height) * 2 + 1,
    );
    this.#raycaster.setFromCamera(this.#pointer, this.#camera);
    const hit = this.#raycaster
      .intersectObjects(machineScene.selectableObjects, false)
      .find((intersection) => intersection.object.visible);
    this.#selectedLayer = machineScene.select(hit?.object ?? null);
    this.invalidate();
    this.#onStatus?.(this.#status());
    return this.#selectedLayer;
  }

  resize(width: number, height: number): void {
    if (
      !this.#renderer ||
      !Number.isFinite(width) ||
      !Number.isFinite(height) ||
      width <= 0 ||
      height <= 0
    ) {
      return;
    }

    const roundedWidth = Math.max(1, Math.round(width));
    const roundedHeight = Math.max(1, Math.round(height));
    this.#camera.aspect = roundedWidth / roundedHeight;
    this.#camera.updateProjectionMatrix();
    this.#renderer.setSize(roundedWidth, roundedHeight, false);
    this.invalidate();
  }

  invalidate(): void {
    if (this.#disposed || !this.#renderer || !this.#machineScene) {
      return;
    }

    this.#dirty = true;
    if (this.#frameRequest === null && !this.#renderInFlight) {
      this.#frameRequest = requestAnimationFrame(this.#renderFrame);
    }
  }

  #renderFrame = async (): Promise<void> => {
    this.#frameRequest = null;
    if (
      this.#disposed ||
      !this.#dirty ||
      !this.#renderer ||
      !this.#machineScene
    ) {
      return;
    }

    this.#dirty = false;
    this.#renderInFlight = true;
    const start = performance.now();

    try {
      await this.#renderer.render(this.#machineScene.scene, this.#camera);
      this.#machineScene.finishStockSurfaceUpload();
      const duration = Math.max(0, performance.now() - start);
      this.#framesRendered += 1;
      this.#frameDurations.push(duration);
      if (this.#frameDurations.length > 60) {
        this.#frameDurations.shift();
      }
      this.#onTelemetry?.(this.#telemetry());
    } finally {
      this.#renderInFlight = false;
      if (this.#dirty && !this.#disposed) {
        this.#frameRequest = requestAnimationFrame(this.#renderFrame);
      }
    }
  };

  #status(): WorkcellRendererStatus {
    const capabilities = this.#capabilities ?? {
      webgpu: false,
      webgl2: false,
      crossOriginIsolated: false,
      maxTextureDimension2d: null,
    };
    const backend =
      this.#backend ?? selectRendererBackend(capabilities, this.#preference);

    return {
      capabilities,
      backend,
      runtimeWarning: this.#runtimeWarning,
      cameraView: this.#cameraView,
      selectedLayer: this.#selectedLayer,
      focusRangeMm: {
        minimum: MINIMUM_FOCUS_DISTANCE_MM,
        maximum: MAXIMUM_FOCUS_DISTANCE_MM,
      },
    };
  }

  #telemetry(): RendererTelemetry {
    const lastFrameMs =
      this.#frameDurations[this.#frameDurations.length - 1] ?? 0;
    const averageFrameMs =
      this.#frameDurations.length === 0
        ? 0
        : this.#frameDurations.reduce((sum, value) => sum + value, 0) /
          this.#frameDurations.length;
    const resources =
      this.#renderer && this.#machineScene
        ? rendererResourceSnapshot(this.#renderer, this.#machineScene)
        : { geometries: 0, textures: 0, programs: 0 };

    return {
      framesRendered: this.#framesRendered,
      lastFrameMs: finite(lastFrameMs),
      averageFrameMs: finite(averageFrameMs),
      resources,
    };
  }

  getDiagnostics(): WorkcellRendererDiagnostics {
    const controlsTarget = this.#controls?.target ?? new Vector3();
    return {
      status: this.#status(),
      telemetry: this.#telemetry(),
      camera: {
        view: this.#cameraView,
        distanceMm: finite(this.#camera.position.distanceTo(controlsTarget)),
        positionMm: sceneToDomainMm(this.#camera.position),
        targetMm: sceneToDomainMm(controlsTarget),
      },
      collisionMarkerMm: this.#collisionMarkerMm,
      stockSurface: this.#machineScene?.getStockSurfaceDiagnostics() ?? null,
    };
  }

  dispose(): void {
    if (this.#disposed) {
      return;
    }
    this.#disposed = true;

    if (this.#frameRequest !== null) {
      cancelAnimationFrame(this.#frameRequest);
      this.#frameRequest = null;
    }
    this.#canvas.removeEventListener("contextmenu", this.#preventContextMenu);
    this.#canvas.removeEventListener("pointerdown", this.#handlePointerDown);
    this.#canvas.removeEventListener("pointermove", this.#handlePointerMove);
    this.#canvas.removeEventListener("pointerup", this.#handlePointerUp);
    this.#canvas.removeEventListener("keydown", this.#handleKeyDown);
    this.#controls?.removeEventListener(
      "change",
      this.#handleControlsChange,
    );
    this.#controls?.dispose();
    this.#machineScene?.dispose();
    this.#renderer?.dispose();
    this.#controls = null;
    this.#machineScene = null;
    this.#renderer = null;
    this.#collisionMarkerMm = null;
  }
}
