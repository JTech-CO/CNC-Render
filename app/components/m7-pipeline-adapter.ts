import type {
  CoordinatorCoreSummary,
  CoordinatorRunRequest,
} from "@cnc-render/contracts";
import type { WorkcellRenderer } from "@cnc-render/renderer/workcell";
import {
  SimulationCoordinator,
  createM7MillingToolpathPoints,
  createM7PipelineFixture,
  resolveM7MillingConfiguration,
  resolveM7MillingOperationParameters,
  type CoordinatorCheckpoint,
  type CoordinatorExecutionMode,
  type CoordinatorRenderUpdate,
  type CoordinatorSnapshot,
  type M7MillingConfiguration,
  type M7MillingConfigurationInput,
  type M7MillingOperationParameters,
  type M7MillingOperationParametersInput,
  type M7PipelineFixture,
} from "@cnc-render/simulation";

export interface M7PipelineBrowserState extends CoordinatorSnapshot {
  readonly fixture: M7PipelineFixture | null;
  readonly millingOperation: M7MillingOperationParameters;
  readonly millingConfiguration: M7MillingConfiguration;
  readonly baselineRenderFrame: number | null;
  readonly renderedOnFrame: number | null;
  readonly playbackElapsedS: number;
  readonly longTasksOver50Ms: number;
  readonly maximumLongTaskMs: number;
}

export interface M7PipelineRunOptions {
  readonly playbackSpeed?: number;
  readonly executionMode?: CoordinatorExecutionMode;
  readonly millingOperation?: M7MillingOperationParametersInput;
  readonly millingConfiguration?: M7MillingConfigurationInput;
}

export interface M7PipelineUiObserver {
  readonly onGeneralSummary?: (
    summary: CoordinatorCoreSummary,
    playbackElapsedS: number,
  ) => void;
  readonly onAxisSummary?: (summary: CoordinatorCoreSummary) => void;
}

interface PlaybackPerformanceWindow {
  readonly startedAtMs: number;
  endedAtMs: number | null;
}

export interface M7PipelineHarness {
  startPipelineFixture(
    fixture: M7PipelineFixture,
    options?: M7PipelineRunOptions,
  ): Promise<CoordinatorCoreSummary>;
  runPipelineFixture(
    fixture: M7PipelineFixture,
    options?: M7PipelineRunOptions,
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
  let millingOperation = resolveM7MillingOperationParameters();
  let millingConfiguration = resolveM7MillingConfiguration();
  let baselineRenderFrame: number | null = null;
  let renderedOnFrame: number | null = null;
  let pendingRender: Promise<number> | null = null;
  let playbackStartedAtMs: number | null = null;
  let playbackEndedAtMs: number | null = null;
  let longTasksOver50Ms = 0;
  let maximumLongTaskMs = 0;
  let performanceMeasurementStarted = false;
  let activePerformanceWindow: PlaybackPerformanceWindow | null = null;
  const playbackPerformanceWindows: PlaybackPerformanceWindow[] = [];
  let longTaskObserver: PerformanceObserver | null = null;

  const recordPlaybackLongTasks = (
    entries: readonly PerformanceEntry[],
  ): void => {
    for (const entry of entries) {
      const belongsToPlayback = playbackPerformanceWindows.some(
        ({ startedAtMs, endedAtMs }) =>
          entry.startTime >= startedAtMs &&
          (endedAtMs === null || entry.startTime <= endedAtMs),
      );
      if (!belongsToPlayback) {
        continue;
      }
      maximumLongTaskMs = Math.max(maximumLongTaskMs, entry.duration);
      if (entry.duration > 50) {
        longTasksOver50Ms += 1;
      }
    }
  };

  const endPerformanceWindow = (endedAtMs = performance.now()): void => {
    if (activePerformanceWindow && activePerformanceWindow.endedAtMs === null) {
      activePerformanceWindow.endedAtMs = endedAtMs;
    }
    activePerformanceWindow = null;
  };

  const flushLongTaskRecords = (): void => {
    if (longTaskObserver) {
      recordPlaybackLongTasks(longTaskObserver.takeRecords());
    }
  };

  const playbackElapsedS = (): number => {
    if (playbackStartedAtMs === null) {
      return 0;
    }
    return Math.max(
      0,
      ((playbackEndedAtMs ?? performance.now()) - playbackStartedAtMs) / 1_000,
    );
  };

  longTaskObserver =
    typeof PerformanceObserver !== "undefined" &&
    PerformanceObserver.supportedEntryTypes.includes("longtask")
      ? new PerformanceObserver((list) => {
          recordPlaybackLongTasks(list.getEntries());
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
    if (
      (summary.completed || summary.stopped) &&
      playbackStartedAtMs !== null &&
      playbackEndedAtMs === null
    ) {
      playbackEndedAtMs = performance.now();
      endPerformanceWindow(playbackEndedAtMs);
    }
    const elapsedS = playbackElapsedS();
    viewport.dataset.pipelineState = summary.stopped
      ? "stopped"
      : summary.completed
        ? "completed"
        : summary.phase;
    viewport.dataset.pipelineRunId = summary.runId;
    viewport.dataset.pipelineFixture = summary.fixtureId;
    viewport.dataset.pipelineLogicalTimeS = String(summary.logicalTimeS);
    viewport.dataset.pipelinePlaybackElapsedS = String(elapsedS);
    viewport.dataset.pipelineStockRevision = String(summary.stockRevision);
    viewport.dataset.pipelineStateHash = summary.stateSemanticHashSha256;
    viewport.dataset.pipelineFinalHash =
      summary.finalSemanticHashSha256 ?? "none";
    viewport.dataset.pipelineWasm = String(summary.wasm);
    viewport.dataset.pipelineWorker = "dedicated";
    viewport.dataset.pipelineGeneralSamples = String(
      coordinator.getSnapshot().metrics.generalUiSamples,
    );
    observer.onGeneralSummary?.(summary, elapsedS);
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
    options: M7PipelineRunOptions = {},
  ): Promise<CoordinatorCoreSummary> {
    fixture = selectedFixture;
    millingConfiguration = resolveM7MillingConfiguration(
      selectedFixture === "milling" ? options.millingConfiguration : {},
    );
    millingOperation = resolveM7MillingOperationParameters(
      selectedFixture === "milling" ? options.millingOperation : {},
    );
    if (!performanceMeasurementStarted) {
      coordinator.beginMainThreadPerformanceWindow();
      longTaskObserver?.takeRecords();
      longTaskObserver?.observe({ entryTypes: ["longtask"] });
      performanceMeasurementStarted = true;
    }
    flushLongTaskRecords();
    baselineRenderFrame =
      renderer.getDiagnostics().telemetry.framesRendered;
    renderedOnFrame = null;
    pendingRender = null;
    playbackStartedAtMs = performance.now();
    playbackEndedAtMs = null;
    activePerformanceWindow = {
      startedAtMs: playbackStartedAtMs,
      endedAtMs: null,
    };
    playbackPerformanceWindows.push(activePerformanceWindow);
    if (playbackPerformanceWindows.length > 4) {
      playbackPerformanceWindows.shift();
    }
    renderer.setCollisionMarker(null);
    renderer.setPresentationMode(
      selectedFixture === "turning" || selectedFixture === "drilling"
        ? "turning"
        : "milling",
    );
    if (
      selectedFixture === "milling" ||
      selectedFixture === "collision-stop"
    ) {
      renderer.setMillingToolpath(
        createM7MillingToolpathPoints(millingConfiguration, millingOperation),
      );
    }
    viewport.dataset.pipelineState = "starting";
    viewport.dataset.pipelineFixture = selectedFixture;
    viewport.dataset.pipelineStockPreset = millingConfiguration.stockPreset;
    viewport.dataset.pipelineCutDirection = millingConfiguration.cutDirection;
    viewport.dataset.pipelineCuttingFeed = String(millingOperation.cuttingFeedMmPerMin);
    viewport.dataset.pipelineSpindleSpeed = String(millingOperation.spindleSpeedRpm);
    viewport.dataset.pipelineCutDepth = String(millingOperation.depthOfCutMm);
    viewport.dataset.pipelinePlaybackElapsedS = "0";
    delete viewport.dataset.pipelineRenderedFrame;
    delete viewport.dataset.pipelineFinalHash;
    const runId = crypto.randomUUID();
    const run: CoordinatorRunRequest = createM7PipelineFixture(
      selectedFixture,
      runId,
      millingConfiguration,
      millingOperation,
    );
    const initialized = await coordinator.start(run, {
      playbackSpeed: options.playbackSpeed ?? 1,
      executionMode: options.executionMode ?? "realtime",
    });
    if (selectedFixture === "turning" || selectedFixture === "drilling") {
      renderer.focusLayer("stock");
    }
    return initialized;
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
    cancelPipeline: async () => {
      await coordinator.cancel();
      if (playbackStartedAtMs !== null && playbackEndedAtMs === null) {
        playbackEndedAtMs = performance.now();
      }
      endPerformanceWindow(playbackEndedAtMs ?? performance.now());
      flushLongTaskRecords();
      viewport.dataset.pipelinePlaybackElapsedS = String(playbackElapsedS());
    },
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
    getPipelineState: () => {
      flushLongTaskRecords();
      return {
        ...coordinator.getSnapshot(),
        fixture,
        millingConfiguration,
        millingOperation,
        baselineRenderFrame,
        renderedOnFrame,
        playbackElapsedS: playbackElapsedS(),
        longTasksOver50Ms,
        maximumLongTaskMs,
      };
    },
  };

  return {
    harness,
    dispose() {
      unsubscribeRender();
      unsubscribeGeneral();
      unsubscribeAxis();
      endPerformanceWindow();
      flushLongTaskRecords();
      longTaskObserver?.disconnect();
      coordinator.dispose();
    },
  };
}
