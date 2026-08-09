"use client";

import type { CoordinatorCoreSummary } from "@cnc-render/contracts";
import {
  CAMERA_PRESETS,
  SCENE_LAYERS,
  type CameraPresetId,
  type RendererPreference,
  type RendererTelemetry,
  type SceneLayerId,
} from "@cnc-render/renderer";
import type {
  WorkcellRenderer,
  WorkcellRendererDiagnostics,
  WorkcellRendererStatus,
} from "@cnc-render/renderer/workcell";
import {
  createM5MillingDemoSession,
  createM6TurningDemoSession,
  runM4CollisionStopDemo,
  type CollisionEvent,
  type LatheRadiusFieldEngine,
  type M5MillingDemoOperation,
  type M6TurningDemoOperation,
  type M7PipelineFixture,
  type MillingMaterialRemovalDiagnostics,
  type SparseDexelMillingEngine,
  type TurningMaterialRemovalDiagnostics,
} from "@cnc-render/simulation";
import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import {
  attachM7Pipeline,
  type M7PipelineHarness,
} from "./m7-pipeline-adapter";
import { attachM8Persistence } from "./m8-persistence-adapter";
import {
  WORKSPACE_COMMAND_EVENT,
  WORKSPACE_STATUS_EVENT,
  type WorkspaceCommand,
  type WorkspaceStatus,
} from "./workspace-events";

interface CncRenderM3Harness {
  getDiagnostics(): WorkcellRendererDiagnostics;
  getReactCommitCount(): number;
  setView(view: CameraPresetId): void;
  fit(): void;
  focusLayer(layerId: SceneLayerId): void;
  orbit(azimuthDegrees: number, polarDegrees: number): void;
  pan(horizontalMm: number, verticalMm: number): void;
  zoom(factor: number): void;
  setLayerVisibility(layerId: SceneLayerId, visible: boolean): void;
}

type CollisionSimulationState = "idle" | "stopping" | "stopped";

interface CncRenderM4Harness extends CncRenderM3Harness {
  runCollisionFixture(): CollisionEvent;
  resetCollisionFixture(): void;
  getCollisionState(): {
    readonly state: CollisionSimulationState;
    readonly event: CollisionEvent | null;
    readonly stoppedOnRenderFrame: number | null;
  };
}

interface M5MillingBrowserRun {
  readonly operation: M5MillingDemoOperation;
  readonly stockHashSha256: string;
  readonly removedVolumeMm3: number;
  readonly engineDiagnostics: MillingMaterialRemovalDiagnostics;
  readonly rendererDiagnostics: NonNullable<
    WorkcellRendererDiagnostics["stockSurface"]
  >;
  readonly baselineRenderFrame: number;
  readonly renderedOnFrame: number | null;
}

interface CncRenderM5Harness extends CncRenderM4Harness {
  runMillingFixture(
    operation: M5MillingDemoOperation,
  ): Promise<M5MillingBrowserRun>;
  getMillingState(): M5MillingBrowserRun | null;
}

interface M6TurningBrowserRun {
  readonly operation: M6TurningDemoOperation;
  readonly profileHashSha256: string;
  readonly removedVolumeMm3: number;
  readonly engineDiagnostics: TurningMaterialRemovalDiagnostics;
  readonly rendererDiagnostics: NonNullable<
    WorkcellRendererDiagnostics["rotationalStockSurface"]
  >;
  readonly baselineRenderFrame: number;
  readonly renderedOnFrame: number | null;
}

interface CncRenderM6Harness extends CncRenderM5Harness {
  runTurningFixture(
    operation: M6TurningDemoOperation,
  ): Promise<M6TurningBrowserRun>;
  getTurningState(): M6TurningBrowserRun | null;
}

declare global {
  interface Window {
    __CNC_RENDER_M3__?: CncRenderM3Harness;
    __CNC_RENDER_M4__?: CncRenderM4Harness;
    __CNC_RENDER_M5__?: CncRenderM5Harness;
    __CNC_RENDER_M6__?: CncRenderM6Harness;
  }
}

function requestedRendererPreference(): RendererPreference {
  const requested = new URLSearchParams(window.location.search).get("renderer");
  return requested === "webgpu" || requested === "webgl2"
    ? requested
    : "auto";
}

function formattedMetric(value: number, fractionDigits = 1): string {
  return Number.isFinite(value) ? value.toFixed(fractionDigits) : "—";
}

function viewLabel(view: WorkcellRendererStatus["cameraView"]): string {
  return view === "custom" ? "사용자 시점" : CAMERA_PRESETS[view].label;
}

function workspaceIcon(kind: "scene" | "code" | "learn" | "report") {
  const paths = {
    scene: (
      <>
        <path d="M4 7.5 12 3l8 4.5v9L12 21l-8-4.5z" />
        <path d="m4 7.5 8 4.5 8-4.5M12 12v9" />
      </>
    ),
    code: (
      <>
        <path d="m8 6-5 6 5 6M16 6l5 6-5 6M14 3l-4 18" />
      </>
    ),
    learn: (
      <>
        <path d="M4 5.5A3.5 3.5 0 0 1 7.5 2H12v18H7.5A3.5 3.5 0 0 0 4 23.5z" />
        <path d="M20 5.5A3.5 3.5 0 0 0 16.5 2H12v18h4.5a3.5 3.5 0 0 1 3.5 3.5z" />
      </>
    ),
    report: (
      <>
        <path d="M5 3h14v18H5zM8 8h8M8 12h8M8 16h5" />
      </>
    ),
  };

  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      {paths[kind]}
    </svg>
  );
}
type WorkspaceArea = "scene" | "code" | "learn" | "results";
type DockTab = "gcode" | "diagnostics";

const WORKSPACE_PLAYBACK_SPEED = 1;

function pipelineState(
  summary: CoordinatorCoreSummary,
): WorkspaceStatus["state"] {
  if (summary.stopped) {
    return "stopped";
  }
  if (summary.completed) {
    return "completed";
  }
  return summary.phase === "initialized" ? "starting" : "running";
}

function dispatchWorkspaceStatus(status: WorkspaceStatus): void {
  window.dispatchEvent(
    new CustomEvent<WorkspaceStatus>(WORKSPACE_STATUS_EVENT, {
      detail: status,
    }),
  );
}

function setPipelineField(
  root: HTMLElement,
  name: string,
  value: string,
): void {
  root
    .querySelectorAll<HTMLElement>(`[data-pipeline-field="${name}"]`)
    .forEach((element) => {
      element.textContent = value;
    });
}

function updatePipelineSummary(
  root: HTMLElement,
  summary: CoordinatorCoreSummary,
): void {
  const state = pipelineState(summary);
  const stateLabel =
    state === "completed"
      ? "완료"
      : state === "stopped"
        ? "충돌 정지"
        : state === "starting"
          ? "준비 중"
          : "절삭 중";

  root.dataset.pipelineUiState = state;
  root.dataset.pipelineUiStep = String(summary.currentStep);
  root.dataset.pipelineUiTotalSteps = String(summary.totalSteps);
  setPipelineField(root, "state", stateLabel);
  setPipelineField(
    root,
    "step",
    `${summary.currentStep.toLocaleString("ko-KR")} / ${summary.totalSteps.toLocaleString("ko-KR")}`,
  );
  setPipelineField(
    root,
    "time",
    `${formattedMetric(summary.logicalTimeS, 3)} s`,
  );
  setPipelineField(
    root,
    "removed",
    `${formattedMetric(summary.removedVolumeMm3, 2)} mm³`,
  );
  setPipelineField(
    root,
    "revision",
    `${summary.stockRevision.toLocaleString("ko-KR")} rev`,
  );
  setPipelineField(
    root,
    "hash",
    (summary.finalSemanticHashSha256 ?? summary.stateSemanticHashSha256).slice(
      0,
      12,
    ),
  );
  root
    .querySelectorAll<HTMLProgressElement>("[data-pipeline-progress]")
    .forEach((progress) => {
      progress.max = Math.max(1, summary.totalSteps);
      progress.value = Math.min(summary.currentStep, progress.max);
      progress.setAttribute(
        "aria-valuetext",
        `${summary.currentStep} / ${summary.totalSteps} 단계`,
      );
    });
  dispatchWorkspaceStatus({
    state,
    fixture:
      summary.fixtureId.includes("turning")
        ? "turning"
        : summary.fixtureId.includes("collision")
          ? "collision-stop"
          : "milling",
  });
}

function updateAxisSummary(
  root: HTMLElement,
  summary: CoordinatorCoreSummary,
): void {
  setPipelineField(
    root,
    "axis",
    `X ${formattedMetric(summary.toolPositionMm.xMm, 2)} mm · Y ${formattedMetric(
      summary.toolPositionMm.yMm,
      2,
    )} mm · Z ${formattedMetric(summary.toolPositionMm.zMm, 2)} mm`,
  );
}

export function MachineWorkspace() {
  const [activeArea, setActiveArea] = useState<WorkspaceArea>("scene");
  const [dockTab, setDockTab] = useState<DockTab>("gcode");
  const workspaceRef = useRef<HTMLDivElement>(null);
  const fixtureSelectRef = useRef<HTMLSelectElement>(null);
  const pipelineHarnessRef = useRef<M7PipelineHarness | null>(null);
  const persistenceHarnessRef = useRef<
    ReturnType<typeof attachM8Persistence>["harness"] | null
  >(null);
  const playToggleRef = useRef<() => Promise<void>>(async () => undefined);
  const stopPipelineRef = useRef<() => Promise<void>>(async () => undefined);
  const saveWorkspaceRef = useRef<() => Promise<void>>(async () => undefined);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<WorkcellRenderer | null>(null);
  const commitCountRef = useRef(0);
  const modeBadgeRef = useRef<HTMLSpanElement>(null);
  const backendDetailRef = useRef<HTMLParagraphElement>(null);
  const cameraReadoutRef = useRef<HTMLSpanElement>(null);
  const selectionReadoutRef = useRef<HTMLSpanElement>(null);
  const frameReadoutRef = useRef<HTMLSpanElement>(null);
  const frameCountRef = useRef<HTMLSpanElement>(null);
  const resourceReadoutRef = useRef<HTMLParagraphElement>(null);
  const limitsRef = useRef<HTMLUListElement>(null);
  const errorRef = useRef<HTMLDivElement>(null);
  const collisionDiagnosticRef = useRef<HTMLDivElement>(null);
  const collisionStatusRef = useRef<HTMLSpanElement>(null);
  const collisionObjectsRef = useRef<HTMLParagraphElement>(null);
  const collisionPositionRef = useRef<HTMLParagraphElement>(null);
  const collisionSourceRef = useRef<HTMLParagraphElement>(null);
  const diagnosticsCountRef = useRef<HTMLSpanElement>(null);
  const programLinesRef = useRef<HTMLOListElement>(null);
  const pendingCollisionRef = useRef<CollisionEvent | null>(null);
  const lastCollisionRef = useRef<CollisionEvent | null>(null);
  const collisionStateRef = useRef<CollisionSimulationState>("idle");
  const collisionStopFrameRef = useRef<number | null>(null);
  const millingEngineRef = useRef<SparseDexelMillingEngine | null>(null);
  const pendingMillingRunRef = useRef<M5MillingBrowserRun | null>(null);
  const lastMillingRunRef = useRef<M5MillingBrowserRun | null>(null);
  const turningEngineRef = useRef<LatheRadiusFieldEngine | null>(null);
  const pendingTurningRunRef = useRef<M6TurningBrowserRun | null>(null);
  const lastTurningRunRef = useRef<M6TurningBrowserRun | null>(null);
  const runCollisionFixtureRef = useRef<() => CollisionEvent>(() => {
    throw new Error("M4 collision fixture is not ready.");
  });
  const resetCollisionFixtureRef = useRef<() => void>(() => undefined);

  useEffect(() => {
    commitCountRef.current += 1;
  });

  useEffect(() => {
    const handleWorkspaceCommand = (event: Event) => {
      const command = (event as CustomEvent<WorkspaceCommand>).detail;
      const operation =
        command.type === "play-toggle"
          ? playToggleRef.current
          : command.type === "stop"
            ? stopPipelineRef.current
            : saveWorkspaceRef.current;
      void operation().catch(() => {
        dispatchWorkspaceStatus({
          state: "error",
          fixture: null,
        });
      });
    };

    window.addEventListener(WORKSPACE_COMMAND_EVENT, handleWorkspaceCommand);
    return () =>
      window.removeEventListener(
        WORKSPACE_COMMAND_EVENT,
        handleWorkspaceCommand,
      );
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const viewport = viewportRef.current;
    const workspace = workspaceRef.current;
    if (!canvas || !viewport || !workspace) {
      return;
    }

    let resizeTimer: number | null = null;
    let resizeObserver: ResizeObserver | null = null;
    let disposed = false;
    let pipelineBinding: ReturnType<typeof attachM7Pipeline> | null = null;
    let persistenceBinding: ReturnType<typeof attachM8Persistence> | null = null;

    const updateStatus = (status: WorkcellRendererStatus) => {
      const mode = status.backend.mode;
      const modeLabel =
        mode === "webgpu"
          ? "WebGPU"
          : mode === "webgl2"
            ? "WebGL 2"
            : "사용 불가";

      viewport.dataset.rendererMode = mode ?? "unavailable";
      viewport.dataset.cameraView = status.cameraView;
      viewport.dataset.selectedLayer = status.selectedLayer ?? "none";

      if (modeBadgeRef.current) {
        modeBadgeRef.current.textContent = modeLabel;
        modeBadgeRef.current.dataset.mode = mode ?? "unavailable";
      }
      if (cameraReadoutRef.current) {
        cameraReadoutRef.current.textContent = viewLabel(status.cameraView);
      }
      if (selectionReadoutRef.current) {
        const selected = SCENE_LAYERS.find(
          (layer) => layer.id === status.selectedLayer,
        );
        selectionReadoutRef.current.textContent =
          selected?.label ?? "선택 없음";
      }
      if (backendDetailRef.current) {
        backendDetailRef.current.textContent =
          status.runtimeWarning ??
          (mode === "webgpu"
            ? "GPU 렌더 경로 · 4× MSAA · compute 준비"
            : mode === "webgl2"
              ? "안전 폴백 · CPU/WASM 메시 프리뷰"
              : "WebGPU 또는 WebGL 2가 필요합니다.");
      }
      if (limitsRef.current) {
        const items = status.backend.limits.map((limit) => {
          const item = document.createElement("li");
          const label = document.createElement("span");
          const value = document.createElement("strong");
          label.textContent = limit.label;
          value.textContent = limit.value;
          item.append(label, value);
          return item;
        });
        limitsRef.current.replaceChildren(...items);
      }
    };

    const updateTelemetry = (telemetry: RendererTelemetry) => {
      viewport.dataset.renderFrames = String(telemetry.framesRendered);
      viewport.dataset.reactCommits = String(commitCountRef.current);

      if (frameReadoutRef.current) {
        frameReadoutRef.current.textContent = `${formattedMetric(
          telemetry.averageFrameMs,
        )} ms`;
      }
      if (frameCountRef.current) {
        frameCountRef.current.textContent =
          `${telemetry.framesRendered.toLocaleString("en-US")} frames`;
      }
      if (resourceReadoutRef.current) {
        const { geometries, textures, programs } = telemetry.resources;
        resourceReadoutRef.current.textContent =
          `${geometries} geometry · ${textures} texture · ${programs} program`;
      }

      const collision = pendingCollisionRef.current;
      if (collision) {
        pendingCollisionRef.current = null;
        collisionStateRef.current = "stopped";
        collisionStopFrameRef.current = telemetry.framesRendered;
        viewport.dataset.simulationState = "stopped";
        viewport.dataset.collisionStoppedFrame = String(
          telemetry.framesRendered,
        );
        viewport.dataset.collisionSourceLine = String(
          collision.sourceLine ?? "none",
        );
        viewport.dataset.collisionPosition = [
          collision.positionMm.xMm,
          collision.positionMm.yMm,
          collision.positionMm.zMm,
        ].join(",");

        if (collisionStatusRef.current) {
          collisionStatusRef.current.textContent = "정지";
          collisionStatusRef.current.dataset.state = "stopped";
        }
        if (collisionDiagnosticRef.current) {
          collisionDiagnosticRef.current.hidden = false;
          collisionDiagnosticRef.current.dataset.objectAId =
            collision.objectAId;
          collisionDiagnosticRef.current.dataset.objectBId =
            collision.objectBId;
        }
        if (collisionObjectsRef.current) {
          collisionObjectsRef.current.textContent = "공구 ↔ 바이스";
        }
        if (collisionPositionRef.current) {
          collisionPositionRef.current.textContent =
            `X ${formattedMetric(collision.positionMm.xMm, 2)} mm · ` +
            `Y ${formattedMetric(collision.positionMm.yMm, 2)} mm · ` +
            `Z ${formattedMetric(collision.positionMm.zMm, 2)} mm`;
        }
        if (collisionSourceRef.current) {
          collisionSourceRef.current.textContent =
            `G-code 원본 ${collision.sourceLine ?? "—"}행 · ` +
            `${formattedMetric(collision.timeS, 3)} s`;
        }
        if (diagnosticsCountRef.current) {
          diagnosticsCountRef.current.textContent = "1";
        }
        programLinesRef.current
          ?.querySelector(`[data-source-line="${collision.sourceLine}"]`)
          ?.classList.add("is-collision");
      }

      const millingRun = pendingMillingRunRef.current;
      if (millingRun) {
        pendingMillingRunRef.current = null;
        const renderedRun = {
          ...millingRun,
          renderedOnFrame: telemetry.framesRendered,
        };
        lastMillingRunRef.current = renderedRun;
        viewport.dataset.millingState = "rendered";
        viewport.dataset.millingOperation = millingRun.operation;
        viewport.dataset.millingRenderedFrame = String(
          telemetry.framesRendered,
        );
        viewport.dataset.millingStockHash = millingRun.stockHashSha256;
        viewport.dataset.stockPartialUpdates = String(
          millingRun.rendererDiagnostics.partialBufferUpdates,
        );
      }

      const turningRun = pendingTurningRunRef.current;
      if (turningRun) {
        pendingTurningRunRef.current = null;
        const renderedRun = {
          ...turningRun,
          renderedOnFrame: telemetry.framesRendered,
        };
        lastTurningRunRef.current = renderedRun;
        viewport.dataset.turningState = "rendered";
        viewport.dataset.turningOperation = turningRun.operation;
        viewport.dataset.turningRenderedFrame = String(
          telemetry.framesRendered,
        );
        viewport.dataset.turningProfileHash = turningRun.profileHashSha256;
        viewport.dataset.rotationalStockPartialUpdates = String(
          turningRun.rendererDiagnostics.partialBufferUpdates,
        );
      }
    };

    void import("@cnc-render/renderer/workcell")
      .then(({ WorkcellRenderer: RuntimeWorkcellRenderer }) => {
        if (disposed) {
          return null;
        }

        const renderer = new RuntimeWorkcellRenderer({
          canvas,
          preference: requestedRendererPreference(),
          onStatus: updateStatus,
          onTelemetry: updateTelemetry,
        });
        rendererRef.current = renderer;

        const resize = () => {
          const bounds = viewport.getBoundingClientRect();
          renderer.resize(bounds.width, bounds.height);
        };
        resizeObserver = new ResizeObserver(() => {
          if (resizeTimer !== null) {
            window.clearTimeout(resizeTimer);
          }
          resizeTimer = window.setTimeout(resize, 80);
        });
        resizeObserver.observe(viewport);

        return renderer.initialize().then((status) => ({
          renderer,
          resize,
          status,
        }));
      })
      .then((result) => {
        if (disposed || !result) {
          return;
        }
        const { renderer, resize, status } = result;
        updateStatus(status);
        resize();
        viewport.dataset.ready = "true";
        viewport.dataset.millingState = "idle";
        viewport.dataset.turningState = "idle";

        const runCollisionFixture = () => {
          const result = runM4CollisionStopDemo();
          const collision = result.events[0];
          pendingCollisionRef.current = collision;
          lastCollisionRef.current = collision;
          collisionStateRef.current = "stopping";
          collisionStopFrameRef.current = null;
          viewport.dataset.simulationState = "stopping";
          delete viewport.dataset.collisionStoppedFrame;
          delete viewport.dataset.collisionSourceLine;
          delete viewport.dataset.collisionPosition;
          if (collisionStatusRef.current) {
            collisionStatusRef.current.textContent = "검증 중";
            collisionStatusRef.current.dataset.state = "stopping";
          }
          if (collisionDiagnosticRef.current) {
            collisionDiagnosticRef.current.hidden = true;
          }
          if (diagnosticsCountRef.current) {
            diagnosticsCountRef.current.textContent = "0";
          }
          programLinesRef.current
            ?.querySelectorAll(".is-collision")
            .forEach((line) => line.classList.remove("is-collision"));
          renderer.setCollisionMarker([
            collision.positionMm.xMm,
            collision.positionMm.yMm,
            collision.positionMm.zMm,
          ]);
          return collision;
        };

        const resetCollisionFixture = () => {
          pendingCollisionRef.current = null;
          lastCollisionRef.current = null;
          collisionStateRef.current = "idle";
          collisionStopFrameRef.current = null;
          viewport.dataset.simulationState = "idle";
          delete viewport.dataset.collisionStoppedFrame;
          delete viewport.dataset.collisionSourceLine;
          delete viewport.dataset.collisionPosition;
          if (collisionStatusRef.current) {
            collisionStatusRef.current.textContent = "준비";
            collisionStatusRef.current.dataset.state = "idle";
          }
          if (collisionDiagnosticRef.current) {
            collisionDiagnosticRef.current.hidden = true;
          }
          if (diagnosticsCountRef.current) {
            diagnosticsCountRef.current.textContent = "0";
          }
          programLinesRef.current
            ?.querySelectorAll(".is-collision")
            .forEach((line) => line.classList.remove("is-collision"));
          renderer.setCollisionMarker(null);
        };

        const runMillingFixture = async (
          operation: M5MillingDemoOperation,
        ): Promise<M5MillingBrowserRun> => {
          const baselineRenderFrame =
            renderer.getDiagnostics().telemetry.framesRendered;
          viewport.dataset.millingState = "updating";
          viewport.dataset.millingOperation = operation;
          delete viewport.dataset.millingRenderedFrame;
          delete viewport.dataset.millingStockHash;
          delete viewport.dataset.stockPartialUpdates;

          const session = createM5MillingDemoSession(operation);
          millingEngineRef.current = session.engine;
          renderer.configureStockSurface(
            session.engine.createFullSurfaceSnapshot(),
          );
          for (const sweep of session.sweeps) {
            session.engine.applySweep(sweep);
          }
          const stockHashSha256 =
            await session.engine.stockHashSha256();
          const rendererDiagnostics = renderer.applyStockSurfacePatches(
            session.engine.drainDirtySurfacePatches(),
          );
          const run: M5MillingBrowserRun = {
            operation,
            stockHashSha256,
            removedVolumeMm3: session.engine.removedVolumeMm3,
            engineDiagnostics: session.engine.getDiagnostics(),
            rendererDiagnostics,
            baselineRenderFrame,
            renderedOnFrame: null,
          };
          pendingMillingRunRef.current = run;
          lastMillingRunRef.current = run;
          return run;
        };

        const runTurningFixture = async (
          operation: M6TurningDemoOperation,
        ): Promise<M6TurningBrowserRun> => {
          const baselineRenderFrame =
            renderer.getDiagnostics().telemetry.framesRendered;
          viewport.dataset.turningState = "updating";
          viewport.dataset.turningOperation = operation;
          delete viewport.dataset.turningRenderedFrame;
          delete viewport.dataset.turningProfileHash;
          delete viewport.dataset.rotationalStockPartialUpdates;

          const session = createM6TurningDemoSession(operation);
          turningEngineRef.current = session.engine;
          renderer.configureRotationalStockSurface(
            session.engine.createFullSurfaceSnapshot(24),
          );
          for (const cut of session.cuts) {
            session.engine.applyCut(cut);
          }
          const profileHashSha256 =
            await session.engine.profileHashSha256();
          const rendererDiagnostics =
            renderer.applyRotationalStockSurfacePatches(
              session.engine.drainDirtySurfacePatches(),
            );
          const run: M6TurningBrowserRun = {
            operation,
            profileHashSha256,
            removedVolumeMm3: session.engine.removedVolumeMm3,
            engineDiagnostics: session.engine.getDiagnostics(),
            rendererDiagnostics,
            baselineRenderFrame,
            renderedOnFrame: null,
          };
          pendingTurningRunRef.current = run;
          lastTurningRunRef.current = run;
          return run;
        };

        const baseHarness: CncRenderM3Harness = {
          getDiagnostics: () => renderer.getDiagnostics(),
          getReactCommitCount: () => commitCountRef.current,
          setView: (view) => renderer.setCameraPreset(view),
          fit: () => renderer.fit(),
          focusLayer: (layerId) => renderer.focusLayer(layerId),
          orbit: (azimuthDegrees, polarDegrees) =>
            renderer.orbitByDegrees(azimuthDegrees, polarDegrees),
          pan: (horizontalMm, verticalMm) =>
            renderer.panByMm(horizontalMm, verticalMm),
          zoom: (factor) => renderer.zoomBy(factor),
          setLayerVisibility: (layerId, visible) =>
            renderer.setLayerVisibility(layerId, visible),
        };
        runCollisionFixtureRef.current = runCollisionFixture;
        resetCollisionFixtureRef.current = resetCollisionFixture;
        const collisionHarness: CncRenderM4Harness = {
          ...baseHarness,
          runCollisionFixture,
          resetCollisionFixture,
          getCollisionState: () => ({
            state: collisionStateRef.current,
            event: lastCollisionRef.current,
            stoppedOnRenderFrame: collisionStopFrameRef.current,
          }),
        };
        window.__CNC_RENDER_M3__ = baseHarness;
        window.__CNC_RENDER_M4__ = collisionHarness;
        window.__CNC_RENDER_M5__ = {
          ...collisionHarness,
          runMillingFixture,
          getMillingState: () => lastMillingRunRef.current,
        };
        window.__CNC_RENDER_M6__ = {
          ...collisionHarness,
          runMillingFixture,
          getMillingState: () => lastMillingRunRef.current,
          runTurningFixture,
          getTurningState: () => lastTurningRunRef.current,
        };
        pipelineBinding = attachM7Pipeline(renderer, viewport, {
          onGeneralSummary: (summary) =>
            updatePipelineSummary(workspace, summary),
          onAxisSummary: (summary) => updateAxisSummary(workspace, summary),
        });
        const pipeline = pipelineBinding.harness;
        pipelineHarnessRef.current = pipeline;

        const selectedFixture = (): M7PipelineFixture => {
          const value = fixtureSelectRef.current?.value;
          return value === "turning" || value === "collision-stop"
            ? value
            : "milling";
        };

        playToggleRef.current = async () => {
          const snapshot = pipeline.getPipelineState();
          const fixture = selectedFixture();
          if (
            (snapshot.status === "running" || snapshot.status === "starting") &&
            snapshot.fixture !== null
          ) {
            await pipeline.pausePipeline();
            dispatchWorkspaceStatus({ state: "paused", fixture });
            return;
          }
          if (snapshot.status === "paused") {
            pipeline.resumePipeline(WORKSPACE_PLAYBACK_SPEED);
            dispatchWorkspaceStatus({ state: "running", fixture });
            return;
          }

          dispatchWorkspaceStatus({ state: "starting", fixture });
          const terminal = await pipeline.runPipelineFixture(fixture, {
            executionMode: "realtime",
            playbackSpeed: WORKSPACE_PLAYBACK_SPEED,
          });
          updatePipelineSummary(workspace, terminal);
        };

        stopPipelineRef.current = async () => {
          await pipeline.cancelPipeline();
          dispatchWorkspaceStatus({
            state: "cancelled",
            fixture: selectedFixture(),
          });
        };
        window.__CNC_RENDER_M7__ = pipelineBinding.harness;
        viewport.dataset.pipelineState = "idle";
        viewport.dataset.pipelineWorker = "dedicated";
        try {
          persistenceBinding = attachM8Persistence(
            pipelineBinding.harness,
            viewport,
          );
          window.__CNC_RENDER_M8__ = persistenceBinding.harness;
          viewport.dataset.persistenceState = "ready";
          persistenceHarnessRef.current = persistenceBinding.harness;
          saveWorkspaceRef.current = async () => {
            const fixture = selectedFixture();
            await persistenceBinding!.harness.saveFixture(
              fixture === "turning" ? "turning" : "milling",
            );
            const summary = pipeline.getPipelineState().summary;
            if (summary) {
              updatePipelineSummary(workspace, summary);
            }
            dispatchWorkspaceStatus({
              state: summary ? pipelineState(summary) : "idle",
              fixture,
              saved: true,
            });
          };
        } catch (error) {
          const diagnostic = error as {
            readonly diagnosticCode?: unknown;
          };
          viewport.dataset.persistenceState = "unavailable";
          viewport.dataset.persistenceDiagnostic =
            typeof diagnostic.diagnosticCode === "string"
              ? diagnostic.diagnosticCode
              : "storage.persistence.unavailable";
        }
        dispatchWorkspaceStatus({ state: "idle", fixture: "milling" });
      })
      .catch((error: unknown) => {
        if (disposed) {
          return;
        }
        viewport.dataset.ready = "error";
        if (errorRef.current) {
          errorRef.current.hidden = false;
          errorRef.current.textContent =
            error instanceof Error
              ? error.message
              : "3D 렌더러를 시작하지 못했습니다.";
        }
      });

    return () => {
      disposed = true;
      resizeObserver?.disconnect();
      if (resizeTimer !== null) {
        window.clearTimeout(resizeTimer);
      }
      persistenceBinding?.dispose();
      pipelineBinding?.dispose();
      rendererRef.current?.dispose();
      rendererRef.current = null;
      millingEngineRef.current = null;
      pendingMillingRunRef.current = null;
      lastMillingRunRef.current = null;
      turningEngineRef.current = null;
      pendingTurningRunRef.current = null;
      lastTurningRunRef.current = null;
      runCollisionFixtureRef.current = () => {
        throw new Error("M4 collision fixture is not ready.");
      };
      resetCollisionFixtureRef.current = () => undefined;
      delete window.__CNC_RENDER_M3__;
      delete window.__CNC_RENDER_M4__;
      delete window.__CNC_RENDER_M5__;
      delete window.__CNC_RENDER_M6__;
      delete window.__CNC_RENDER_M7__;
      delete window.__CNC_RENDER_M8__;
    };
  }, []);

  const setView = (view: CameraPresetId) => {
    rendererRef.current?.setCameraPreset(view);
  };
  const selectWorkspaceArea = (area: WorkspaceArea) => {
    setActiveArea(area);
    if (area === "code") {
      setDockTab("gcode");
    } else if (area === "results") {
      setDockTab("diagnostics");
    }
    window.requestAnimationFrame(() => {
      const root = workspaceRef.current;
      const summary = pipelineHarnessRef.current?.getPipelineState().summary;
      if (root && summary) {
        updatePipelineSummary(root, summary);
        updateAxisSummary(root, summary);
      }
    });
  };

  const handleDockTabKeyDown = (
    event: ReactKeyboardEvent<HTMLButtonElement>,
  ) => {
    if (
      event.key !== "ArrowLeft" &&
      event.key !== "ArrowRight" &&
      event.key !== "Home" &&
      event.key !== "End"
    ) {
      return;
    }
    const tablist = event.currentTarget.closest('[role="tablist"]');
    const tabs = tablist
      ? Array.from(
          tablist.querySelectorAll<HTMLButtonElement>(
            '[role="tab"]:not(:disabled)',
          ),
        )
      : [];
    if (tabs.length === 0) {
      return;
    }
    const currentIndex = Math.max(0, tabs.indexOf(event.currentTarget));
    const nextIndex =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? tabs.length - 1
          : event.key === "ArrowRight"
            ? (currentIndex + 1) % tabs.length
            : (currentIndex - 1 + tabs.length) % tabs.length;
    const nextTab = tabs[nextIndex];
    if (!nextTab) {
      return;
    }
    event.preventDefault();
    nextTab.focus();
    nextTab.click();
  };
  return (
    <div
      className="workspace-grid"
      data-active-area={activeArea}
      ref={workspaceRef}
    >
      <nav className="activity-rail" aria-label="작업 영역">
        <button
          aria-current={activeArea === "scene" ? "page" : undefined}
          className={`activity-button ${activeArea === "scene" ? "is-active" : ""}`}
          data-testid="workspace-area-scene"
          onClick={() => selectWorkspaceArea("scene")}
          type="button"
        >
          {workspaceIcon("scene")}
          <span>장면</span>
        </button>
        <button
          aria-current={activeArea === "code" ? "page" : undefined}
          className={`activity-button ${activeArea === "code" ? "is-active" : ""}`}
          data-testid="workspace-area-code"
          onClick={() => selectWorkspaceArea("code")}
          type="button"
        >
          {workspaceIcon("code")}
          <span>코드</span>
        </button>
        <button
          aria-current={activeArea === "learn" ? "page" : undefined}
          className={`activity-button ${activeArea === "learn" ? "is-active" : ""}`}
          data-testid="workspace-area-learn"
          onClick={() => selectWorkspaceArea("learn")}
          type="button"
        >
          {workspaceIcon("learn")}
          <span>학습</span>
        </button>
        <button
          aria-current={activeArea === "results" ? "page" : undefined}
          className={`activity-button ${activeArea === "results" ? "is-active" : ""}`}
          data-testid="workspace-area-results"
          onClick={() => selectWorkspaceArea("results")}
          type="button"
        >
          {workspaceIcon("report")}
          <span>결과</span>
        </button>
      </nav>

      <aside className="scene-panel" aria-labelledby="scene-heading">
        <div className="panel-heading">
          <div>
            <p>SCENE GRAPH</p>
            <h2 id="scene-heading">VMC 교육 Fixture</h2>
          </div>
          <span className="panel-count">6 layers</span>
        </div>

        <div className="scene-tree" aria-label="렌더 장면 레이어">
          <div
            className="tree-root"
          >
            <span className="tree-disclosure" aria-hidden="true">
              ▾
            </span>
            <span className="tree-root-mark" aria-hidden="true" />
            <strong>VMC-3X-EDU</strong>
          </div>
          <div className="tree-children">
            {SCENE_LAYERS.map((layer) => (
              <label
                className="layer-row"
                data-layer-id={layer.id}
                key={layer.id}
              >
                <input
                  type="checkbox"
                  defaultChecked={layer.defaultVisible}
                  onChange={(event) =>
                    rendererRef.current?.setLayerVisibility(
                      layer.id,
                      event.currentTarget.checked,
                    )
                  }
                />
                <span
                  className={`layer-swatch layer-swatch-${layer.id}`}
                  aria-hidden="true"
                />
                <span className="layer-copy">
                  <strong>{layer.label}</strong>
                  <small>{layer.collisionGroupId}</small>
                </span>
                <code>{layer.collisionMask}</code>
              </label>
            ))}
          </div>
        </div>

        <div className="scene-panel-note">
          <span>좌표계</span>
          <strong>G54 · X/Y/Z · mm</strong>
          <p>렌더 경계는 1 scene unit = 1 mm를 사용합니다.</p>
        </div>
      </aside>
      {activeArea !== "scene" ? (
        <aside className="context-panel" aria-labelledby="context-heading">
          <div className="panel-heading">
            <div>
              <p>CONTEXT RAIL</p>
              <h2 id="context-heading">
                {activeArea === "code"
                  ? "코드"
                  : activeArea === "learn"
                    ? "학습"
                    : "결과"}
              </h2>
            </div>
            <span className="panel-count">M9</span>
          </div>

          {activeArea === "code" ? (
            <div className="context-content">
              <p className="context-kicker">CURRENT PROGRAM</p>
              <h3>대표 밀링 Fixture</h3>
              <ol className="context-code" aria-label="현재 G-code">
                <li><code>G21 G90</code></li>
                <li><code>G0 X-10 Y-5 Z8</code></li>
                <li><code>G1 Z4 F6000</code></li>
                <li><code>G1 X10 Y5</code></li>
                <li><code>M30</code></li>
              </ol>
              <p className="context-note">
                이 영역은 M9에서 탐색과 실행 문맥을 제공합니다. Monaco 편집,
                줄 진단, 브레이크포인트는 M11에서 연결됩니다.
              </p>
            </div>
          ) : activeArea === "learn" ? (
            <div className="context-content">
              <p className="context-kicker">GUIDED PREVIEW</p>
              <h3>소재 절삭 확인</h3>
              <ol className="learning-steps">
                <li><strong>1</strong><span>밀링 대표 공정을 선택합니다.</span></li>
                <li><strong>2</strong><span>실행 후 공구와 소재 변화를 관찰합니다.</span></li>
                <li><strong>3</strong><span>결과 영역에서 제거 체적을 확인합니다.</span></li>
              </ol>
              <button
                className="context-primary"
                onClick={() => {
                  if (fixtureSelectRef.current) {
                    fixtureSelectRef.current.value = "milling";
                  }
                  void playToggleRef.current();
                }}
                type="button"
              >
                기본 절삭 실행
              </button>
              <p className="context-note">
                단계 검증·힌트·채점과 밀링/선삭/드릴링 정식 튜토리얼은 M10
                범위입니다.
              </p>
            </div>
          ) : (
            <div className="context-content" aria-live="polite">
              <p className="context-kicker">RUN SUMMARY · E2</p>
              <h3 data-pipeline-field="state">아직 실행하지 않음</h3>
              <dl className="result-list">
                <div>
                  <dt>진행 단계</dt>
                  <dd data-pipeline-field="step">0 / 0</dd>
                </div>
                <div>
                  <dt>논리 시간</dt>
                  <dd data-pipeline-field="time">0.000 s</dd>
                </div>
                <div>
                  <dt>제거 체적</dt>
                  <dd data-pipeline-field="removed">0.00 mm³</dd>
                </div>
                <div>
                  <dt>소재 revision</dt>
                  <dd data-pipeline-field="revision">0 rev</dd>
                </div>
                <div>
                  <dt>결과 hash</dt>
                  <dd data-pipeline-field="hash">—</dd>
                </div>
              </dl>
              <p className="context-note">
                목표 형상 비교·측정·Heatmap·리포트 내보내기는 M11에서
                제공됩니다.
              </p>
            </div>
          )}
        </aside>
      ) : null}

      <section className="viewport-shell" aria-labelledby="viewport-heading">
        <header className="viewport-toolbar">
          <div className="viewport-title">
            <span className="status-dot" aria-hidden="true" />
            <div>
              <p>3D WORKSPACE</p>
              <h1 id="viewport-heading">Machine setup</h1>
            </div>
          </div>
          <div className="view-actions" aria-label="카메라 시점">
            {(["front", "top", "right", "isometric"] as const).map(
              (view) => (
                <button
                  data-view={view}
                  key={view}
                  onClick={() => setView(view)}
                  type="button"
                >
                  {CAMERA_PRESETS[view].label}
                </button>
              ),
            )}
            <button
              className="fit-button"
              data-view="fit"
              onClick={() => rendererRef.current?.fit()}
              type="button"
            >
              맞춤 <kbd>F</kbd>
            </button>
          </div>
        </header>

        <div
          className="viewport-stage"
          data-camera-view="isometric"
          data-react-commits="0"
          data-ready="false"
          data-render-frames="0"
          data-renderer-mode="detecting"
          data-simulation-state="idle"
          data-testid="machine-viewport"
          ref={viewportRef}
        >
          <canvas
            aria-label="CNC 수직형 머시닝 센터 3D 장면. 우클릭 드래그로 회전, 중클릭 드래그로 이동, 휠로 확대하며 F 키로 장면을 맞춥니다."
            data-testid="machine-canvas"
            ref={canvasRef}
            tabIndex={0}
          />
          <div className="viewport-axis" aria-hidden="true">
            <span className="axis-z">Z</span>
            <span className="axis-x">X</span>
            <span className="axis-y">Y</span>
          </div>
          <div className="viewport-mode" aria-live="polite">
            <span ref={modeBadgeRef}>감지 중</span>
            <p ref={backendDetailRef}>렌더링 기능을 확인하고 있습니다.</p>
          </div>
          <div className="viewport-error" hidden ref={errorRef} role="alert" />
          <div
            className="collision-stop-banner"
            data-testid="collision-diagnostic"
            hidden
            ref={collisionDiagnosticRef}
            role="alert"
          >
            <strong>충돌로 시뮬레이션 정지</strong>
            <p ref={collisionObjectsRef}>공구 ↔ 바이스</p>
            <p ref={collisionPositionRef}>X — mm · Y — mm · Z — mm</p>
            <p ref={collisionSourceRef}>G-code 원본 —행 · — s</p>
          </div>
          <div className="viewport-help" aria-label="3D 조작 도움말">
            <span>우클릭 Orbit</span>
            <span>중클릭 Pan</span>
            <span>휠 Zoom</span>
            <span>
              <kbd>Esc</kbd> 선택 해제
            </span>
          </div>
        </div>

        <footer className="viewport-status" aria-label="렌더 상태">
          <span>
            시점 <strong ref={cameraReadoutRef}>등각</strong>
          </span>
          <span>
            선택 <strong ref={selectionReadoutRef}>선택 없음</strong>
          </span>
          <span>
            평균 프레임 <strong ref={frameReadoutRef}>— ms</strong>
          </span>
          <span ref={frameCountRef}>0 frames</span>
        </footer>
      </section>

      <aside className="inspector-panel" aria-labelledby="inspector-heading">
        <div className="panel-heading inspector-heading">
          <div>
            <p>INSPECTOR</p>
            <h2 id="inspector-heading">렌더·충돌 진단</h2>
          </div>
          <span className="accuracy-badge">E2</span>
        </div>

        <section className="inspector-section" aria-labelledby="backend-heading">
          <div className="section-label">
            <h3 id="backend-heading">Backend limits</h3>
            <span>자동 감지</span>
          </div>
          <ul className="limit-list" ref={limitsRef}>
            <li>
              <span>상태</span>
              <strong>확인 중</strong>
            </li>
          </ul>
        </section>

        <section className="inspector-section" aria-labelledby="camera-heading">
          <div className="section-label">
            <h3 id="camera-heading">Camera</h3>
            <span>Perspective 38°</span>
          </div>
          <dl className="metric-grid">
            <div>
              <dt>Focus range</dt>
              <dd>180–5,000 mm</dd>
            </div>
            <div>
              <dt>Near / Far</dt>
              <dd>1 / 10,000 mm</dd>
            </div>
          </dl>
          <button
            className="secondary-control"
            onClick={() => rendererRef.current?.focusLayer("stock")}
            type="button"
          >
            소재 범위에 포커스
          </button>
        </section>
        <section
          className="inspector-section simulation-section"
          aria-labelledby="simulation-heading"
        >
          <div className="section-label">
            <h3 id="simulation-heading">Worker/WASM 절삭</h3>
            <span data-pipeline-field="state">준비</span>
          </div>
          <label className="fixture-select">
            <span>대표 공정</span>
            <select
              data-testid="pipeline-fixture"
              defaultValue="milling"
              ref={fixtureSelectRef}
            >
              <option value="milling">3축 밀링</option>
              <option value="turning">외경 선삭</option>
              <option value="collision-stop">충돌 정지</option>
            </select>
          </label>
          <progress
            aria-label="시뮬레이션 진행"
            data-pipeline-progress
            max={1}
            value={0}
          />
          <div className="simulation-controls">
            <button
              className="simulation-primary"
              data-pipeline-action="play"
              data-testid="pipeline-play"
              onClick={() => void playToggleRef.current()}
              type="button"
            >
              실행 / 일시정지
            </button>
            <button
              className="secondary-control"
              data-testid="pipeline-stop"
              onClick={() => void stopPipelineRef.current()}
              type="button"
            >
              정지
            </button>
          </div>
          <dl className="simulation-readout" aria-live="polite">
            <div>
              <dt>단계</dt>
              <dd data-pipeline-field="step">0 / 0</dd>
            </div>
            <div>
              <dt>시간</dt>
              <dd data-pipeline-field="time">0.000 s</dd>
            </div>
            <div>
              <dt>공구 위치</dt>
              <dd data-pipeline-field="axis">X 0.00 mm · Y 0.00 mm · Z 0.00 mm</dd>
            </div>
            <div>
              <dt>제거 체적</dt>
              <dd data-pipeline-field="removed">0.00 mm³</dd>
            </div>
          </dl>
          <p className="inspector-explanation">
            전용 Worker가 Rust/WASM 코어를 실행하고 Stock 패치와 공구 위치를
            React 프레임 갱신 없이 렌더러에 전달합니다.
          </p>
        </section>

        <section
          className="inspector-section"
          aria-labelledby="collision-heading"
        >
          <div className="section-label">
            <h3 id="collision-heading">Collision guard</h3>
            <span data-state="idle" ref={collisionStatusRef}>
              준비
            </span>
          </div>
          <div className="collision-controls">
            <button
              className="collision-control-primary"
              data-testid="run-collision-fixture"
              onClick={() => runCollisionFixtureRef.current()}
              type="button"
            >
              충돌 Fixture 실행
            </button>
            <button
              className="secondary-control"
              data-testid="reset-collision-fixture"
              onClick={() => resetCollisionFixtureRef.current()}
              type="button"
            >
              초기화
            </button>
          </div>
          <p className="inspector-explanation">
            단순 충돌 프록시로 검사하며, stop 이벤트는 다음 렌더 프레임에서
            3D 위치와 원본 줄에 연결됩니다.
          </p>
        </section>

        <section
          className="inspector-section"
          aria-labelledby="resource-heading"
        >
          <div className="section-label">
            <h3 id="resource-heading">Resource telemetry</h3>
            <span>on demand</span>
          </div>
          <p className="resource-line" ref={resourceReadoutRef}>
            0 geometry · 0 texture · 0 program
          </p>
          <p className="inspector-explanation">
            프레임은 카메라·크기·레이어가 바뀔 때만 예약되며 React commit과
            분리됩니다.
          </p>
        </section>

        <aside className="education-disclaimer">
          <strong>교육용 운동학·충돌 Fixture · 정확도 E2</strong>
          <p>
            현재 결과는 결정론적 단순 형상 검증입니다. 산업용 충돌 검증이나
            실제 장비 제어 결과와 동일하지 않습니다.
          </p>
        </aside>
      </aside>

      <section className="bottom-dock" aria-labelledby="dock-heading">
        <header className="dock-tabs">
          <h2 id="dock-heading">Program preview</h2>
          <div role="tablist" aria-label="하단 패널">
            <button
              aria-controls="dock-gcode-panel"
              aria-selected={dockTab === "gcode"}
              id="dock-gcode-tab"
              onClick={() => setDockTab("gcode")}
              onKeyDown={handleDockTabKeyDown}
              role="tab"
              tabIndex={dockTab === "gcode" ? 0 : -1}
              type="button"
            >
              G-code
            </button>
            <button
              aria-controls="dock-diagnostics-panel"
              aria-selected={dockTab === "diagnostics"}
              id="dock-diagnostics-tab"
              onClick={() => setDockTab("diagnostics")}
              onKeyDown={handleDockTabKeyDown}
              role="tab"
              tabIndex={dockTab === "diagnostics" ? 0 : -1}
              type="button"
            >
              Diagnostics <span ref={diagnosticsCountRef}>0</span>
            </button>
          </div>
        </header>
        <div
          aria-labelledby="dock-gcode-tab"
          className="program-preview"
          hidden={dockTab !== "gcode"}
          id="dock-gcode-panel"
          role="tabpanel"
        >
          <ol aria-label="교육용 G-code 미리보기" ref={programLinesRef}>
            <li data-source-line="1">
              <code>G21 G17 G90</code>
              <span>mm · XY plane · absolute</span>
            </li>
            <li data-source-line="2">
              <code>G54 G0 X-145 Y-70 Z370</code>
              <span>fixture start</span>
            </li>
            <li className="is-current" data-source-line="3">
              <code>G1 Z338 F420</code>
              <span>preview segment</span>
            </li>
            <li data-source-line="4">
              <code>G1 X145</code>
              <span>toolpath guide</span>
            </li>
          </ol>
          <div className="dock-summary">
            <span>Fixture</span>
            <strong>M4-collision-stop</strong>
            <span>Execution</span>
            <strong>결정론적 E2 검증</strong>
          </div>
        </div>
        <div
          aria-labelledby="dock-diagnostics-tab"
          className="diagnostics-preview"
          hidden={dockTab !== "diagnostics"}
          id="dock-diagnostics-panel"
          role="tabpanel"
        >
          <div className="diagnostic-empty">
            <strong data-pipeline-field="state">진단 대기</strong>
            <p>
              실행 상태 <span data-pipeline-field="step">0 / 0</span> ·
              제거 체적 <span data-pipeline-field="removed">0.00 mm³</span>
            </p>
            <p data-pipeline-field="axis">
              X 0.00 mm · Y 0.00 mm · Z 0.00 mm
            </p>
          </div>
          <div className="diagnostic-link-note">
            충돌 발생 시 아이콘·문구·원본 줄·3D 위치가 함께 표시됩니다.
          </div>
        </div>
      </section>
    </div>
  );
}
