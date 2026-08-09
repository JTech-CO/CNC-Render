import type {
  CoordinatorCoreSummary,
  CoordinatorRunRequest,
} from "@cnc-render/contracts";
import type { WorkcellRenderer } from "@cnc-render/renderer/workcell";
import {
  SimulationCoordinator,
  createM7PipelineFixture,
  type CoordinatorCheckpoint,
  type CoordinatorExecutionMode,
  type CoordinatorRenderUpdate,
  type CoordinatorSnapshot,
  type M7PipelineFixture,
} from "@cnc-render/simulation";

export interface M7PipelineBrowserState extends CoordinatorSnapshot {
  readonly fixture: M7PipelineFixture | null;
  readonly baselineRenderFrame: number | null;
  readonly renderedOnFrame: number | null;
  readonly longTasksOver50Ms: number;
  readonly maximumLongTaskMs: number;
}

export interface M7PipelineUiObserver {
  readonly onGeneralSummary?: (summary: CoordinatorCoreSummary) => void;
  readonly onAxisSummary?: (summary: CoordinatorCoreSummary) => void;
}

export interface M7PipelineHarness {
  startPipelineFixture(
    fixture: M7PipelineFixture,
    options?: {
      readonly playbackSpeed?: number;
      readonly executionMode?: CoordinatorExecutionMode;
    },
  ): Promise<CoordinatorCoreSummary>;
  runPipelineFixture(
    fixture: M7PipelineFixture,
    options?: {
      readonly playbackSpeed?: number;
      readonly executionMode?: CoordinatorExecutionMode;
    },
  ): Promise<CoordinatorCoreSummary>;
  pausePipeline(): Promise<CoordinatorCoreSummary>;
  resumePipeline(playbackSpeed?: number): void;
  cancelPipeline(): Promise<void>;
  capturePipelineCheckpoint(): Promise<CoordinatorCheckpoint>;
  renderPipelineCheckpoint(
    checkpoint: CoordinatorCheckpoint,
  ): Promise<number>;
  restartPipelineWorker(): Promise<void>;
  getPipelineState(): M7PipelineBrowserState;
}

declare global {
  interface Window {
    __CNC_RENDER_M7__?: M7PipelineHarness;
  }
}

function applyRenderUpdate(
  renderer: WorkcellRenderer,
  update: CoordinatorRenderUpdate,
): void {
  switch (update.renderType) {
    case "milling-full":
      renderer.configureStockSurface({
        boundsMm: update.boundsMm,
        columns: update.columns,
        rows: update.rows,
        resolutionMm: update.resolutionMm,
        topZMm: update.topZMm,
      });
      return;
    case "milling-patch":
      renderer.applyStockSurfacePatches([
        {
          revision: update.revision,
          brickX: update.brickX,
          brickY: update.brickY,
          cellIndices: update.cellIndices,
          topZMm: update.topZMm,
        },
      ]);
      return;
    case "turning-full":
      renderer.configureRotationalStockSurface({
        axisCenterMm: update.axisCenterMm,
        minimumZMm: update.minimumZMm,
        maximumZMm: update.maximumZMm,
        axialCells: update.axialCells,
        radialSegments: update.radialSegments,
        resolutionMm: update.resolutionMm,
        innerRadiusMm: update.innerRadiusMm,
        outerRadiusMm: update.outerRadiusMm,
      });
      return;
    case "turning-patch":
      renderer.applyRotationalStockSurfacePatches([
        {
          revision: update.revision,
          cellIndices: update.cellIndices,
          innerRadiusMm: update.innerRadiusMm,
          outerRadiusMm: update.outerRadiusMm,
        },
      ]);
  }
}

function waitForNextRenderedFrame(
  renderer: WorkcellRenderer,
  baselineFrame: number,
  timeoutMs = 5_000,
): Promise<number> {
  const startedAt = performance.now();
  return new Promise((resolve, reject) => {
    const check = () => {
      const frame = renderer.getDiagnostics().telemetry.framesRendered;
      if (frame > baselineFrame) {
        resolve(frame);
        return;
      }
      if (performance.now() - startedAt > timeoutMs) {
        reject(new Error("Renderer did not consume the Worker update in time."));
        return;
      }
      requestAnimationFrame(check);
    };
    requestAnimationFrame(check);
  });
}

export function attachM7Pipeline(
  renderer: WorkcellRenderer,
  viewport: HTMLElement,
  observer: M7PipelineUiObserver = {},
): { readonly harness: M7PipelineHarness; dispose(): void } {
  const coordinator = new SimulationCoordinator();
  let fixture: M7PipelineFixture | null = null;
  let baselineRenderFrame: number | null = null;
  let renderedOnFrame: number | null = null;
  let pendingRender: Promise<number> | null = null;
  let longTasksOver50Ms = 0;
  let maximumLongTaskMs = 0;

  let observingLongTasks = false;
  const longTaskObserver =
    typeof PerformanceObserver !== "undefined" &&
    PerformanceObserver.supportedEntryTypes.includes("longtask")
      ? new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            maximumLongTaskMs = Math.max(maximumLongTaskMs, entry.duration);
            if (entry.duration > 50) {
              longTasksOver50Ms += 1;
            }
          }
        })
      : null;

  const unsubscribeRender = coordinator.onRender((update, summary) => {
    const before = renderer.getDiagnostics().telemetry.framesRendered;
    applyRenderUpdate(renderer, update);
    if (summary.collision) {
      renderer.setCollisionMarker([
        summary.collision.positionMm.xMm,
        summary.collision.positionMm.yMm,
        summary.collision.positionMm.zMm,
      ]);
    }
    pendingRender = waitForNextRenderedFrame(renderer, before)
      .then((frame) => {
        renderedOnFrame = frame;
        viewport.dataset.pipelineRenderedFrame = String(frame);
        return frame;
      })
      .catch(() => before);
  });

  const unsubscribeGeneral = coordinator.onGeneralSummary((summary) => {
    viewport.dataset.pipelineState = summary.stopped
      ? "stopped"
      : summary.completed
        ? "completed"
        : summary.phase;
    viewport.dataset.pipelineRunId = summary.runId;
    viewport.dataset.pipelineFixture = summary.fixtureId;
    viewport.dataset.pipelineLogicalTimeS = String(summary.logicalTimeS);
    viewport.dataset.pipelineStockRevision = String(summary.stockRevision);
    viewport.dataset.pipelineStateHash = summary.stateSemanticHashSha256;
    viewport.dataset.pipelineFinalHash =
      summary.finalSemanticHashSha256 ?? "none";
    viewport.dataset.pipelineWasm = String(summary.wasm);
    viewport.dataset.pipelineWorker = "dedicated";
    viewport.dataset.pipelineGeneralSamples = String(
      coordinator.getSnapshot().metrics.generalUiSamples,
    );
    observer.onGeneralSummary?.(summary);
  });

  const unsubscribeAxis = coordinator.onAxisSummary((summary) => {
    viewport.dataset.pipelineAxisPosition = [
      summary.toolPositionMm.xMm,
      summary.toolPositionMm.yMm,
      summary.toolPositionMm.zMm,
    ].join(",");
    viewport.dataset.pipelineAxisSamples = String(
      coordinator.getSnapshot().metrics.axisUiSamples,
    );
    renderer.setToolPositionMm([
      summary.toolPositionMm.xMm,
      summary.toolPositionMm.yMm,
      summary.toolPositionMm.zMm,
    ]);
    observer.onAxisSummary?.(summary);
  });

  async function start(
    selectedFixture: M7PipelineFixture,
    options: {
      readonly playbackSpeed?: number;
      readonly executionMode?: CoordinatorExecutionMode;
    } = {},
  ): Promise<CoordinatorCoreSummary> {
    fixture = selectedFixture;
    if (longTaskObserver && !observingLongTasks) {
      longTaskObserver.takeRecords();
      longTaskObserver.observe({ entryTypes: ["longtask"] });
      observingLongTasks = true;
    }
    baselineRenderFrame =
      renderer.getDiagnostics().telemetry.framesRendered;
    renderedOnFrame = null;
    pendingRender = null;
    renderer.setCollisionMarker(null);
    viewport.dataset.pipelineState = "starting";
    viewport.dataset.pipelineFixture = selectedFixture;
    delete viewport.dataset.pipelineRenderedFrame;
    delete viewport.dataset.pipelineFinalHash;
    const runId = crypto.randomUUID();
    const run: CoordinatorRunRequest = createM7PipelineFixture(
      selectedFixture,
      runId,
    );
    return coordinator.start(run, {
      playbackSpeed: options.playbackSpeed ?? 1,
      executionMode: options.executionMode ?? "realtime",
    });
  }

  const harness: M7PipelineHarness = {
    startPipelineFixture: start,
    async runPipelineFixture(selectedFixture, options) {
      const initialized = await start(selectedFixture, options);
      const terminal = await coordinator.waitForTerminal(initialized.runId);
      await pendingRender;
      return terminal;
    },
    pausePipeline: () => coordinator.pause(),
    resumePipeline: (playbackSpeed = 1) =>
      coordinator.resume(playbackSpeed),
    cancelPipeline: () => coordinator.cancel(),
    capturePipelineCheckpoint: () => coordinator.checkpoint(),
    async renderPipelineCheckpoint(checkpoint) {
      const before = renderer.getDiagnostics().telemetry.framesRendered;
      applyRenderUpdate(renderer, checkpoint.render);
      const frame = await waitForNextRenderedFrame(renderer, before);
      renderedOnFrame = frame;
      viewport.dataset.pipelineRenderedFrame = String(frame);
      viewport.dataset.pipelineState = "checkpoint-restored";
      viewport.dataset.pipelineStateHash =
        checkpoint.summary.stateSemanticHashSha256;
      viewport.dataset.pipelineStockRevision = String(
        checkpoint.summary.stockRevision,
      );
      return frame;
    },
    restartPipelineWorker: () => coordinator.restartWorker(),
    getPipelineState: () => ({
      ...coordinator.getSnapshot(),
      fixture,
      baselineRenderFrame,
      renderedOnFrame,
      longTasksOver50Ms,
      maximumLongTaskMs,
    }),
  };

  return {
    harness,
    dispose() {
      unsubscribeRender();
      unsubscribeGeneral();
      unsubscribeAxis();
      longTaskObserver?.disconnect();
      coordinator.dispose();
    },
  };
}
