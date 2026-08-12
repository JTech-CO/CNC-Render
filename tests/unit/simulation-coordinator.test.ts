import {
  SimulationCoordinator,
  createM7PipelineFixture,
} from "@cnc-render/simulation";
import { describe, expect, it } from "vitest";
import { SyntheticCoordinatorWorker } from "../helpers/synthetic-coordinator-worker";

describe("M7 simulation coordinator lifecycle", () => {
  it("rejects events from replaced runs, restarted Workers, and stale sequences", async () => {
    const workers: SyntheticCoordinatorWorker[] = [];
    const coordinator = new SimulationCoordinator(() => {
      const worker = new SyntheticCoordinatorWorker();
      workers.push(worker);
      return worker;
    });
    const firstRun = createM7PipelineFixture(
      "milling",
      "70000000-0000-4000-8000-000000000311",
    );
    await coordinator.start(firstRun, {
      playbackSpeed: 1,
      executionMode: "realtime",
    });
    const replacedWorker = workers[0];

    await coordinator.restartWorker();
    replacedWorker.emitRunUpdate(firstRun, 2);

    const secondRun = createM7PipelineFixture(
      "turning",
      "70000000-0000-4000-8000-000000000312",
    );
    await coordinator.start(secondRun, {
      playbackSpeed: 100,
      executionMode: "fast-forward",
    });
    const activeWorker = workers[1];
    activeWorker.emitRunUpdate(firstRun, 2);
    activeWorker.emitRunUpdate(secondRun, 1);
    activeWorker.emitRunUpdate(secondRun, 2);

    const snapshot = coordinator.getSnapshot();
    expect(replacedWorker.terminated).toBe(true);
    expect(snapshot.metrics.staleEventsRejected).toBe(3);
    expect(snapshot.summary).toMatchObject({
      runId: secondRun.runId,
      fixtureId: "m7-turning",
      currentStep: 2,
    });
    coordinator.dispose();
  });

  it("samples general UI at 10 Hz and axes at 20 Hz independently of Worker messages", async () => {
    const worker = new SyntheticCoordinatorWorker();
    const coordinator = new SimulationCoordinator(() => worker);
    const run = createM7PipelineFixture(
      "milling",
      "70000000-0000-4000-8000-000000000313",
    );
    await coordinator.start(run, {
      playbackSpeed: 1,
      executionMode: "realtime",
    });

    const startedAt = performance.now();
    for (let sequence = 2; sequence <= 2_001; sequence += 1) {
      worker.emitRunUpdate(run, sequence);
    }
    const durationMs = performance.now() - startedAt;
    const metrics = coordinator.getSnapshot().metrics;

    expect(metrics.workerMessages).toBe(2_002);
    expect(metrics.generalUiSamples).toBeLessThanOrEqual(
      Math.floor(durationMs / 100) + 2,
    );
    expect(metrics.axisUiSamples).toBeLessThanOrEqual(
      Math.floor(durationMs / 50) + 2,
    );
    expect(metrics.axisUiSamples).toBeGreaterThanOrEqual(
      metrics.generalUiSamples,
    );
    expect(metrics.maximumMainHandlerMs).toBeGreaterThan(0);
    expect(metrics.maximumMainHandlerMs).toBeLessThan(50);
    coordinator.beginMainThreadPerformanceWindow();
    expect(coordinator.getSnapshot().metrics.maximumMainHandlerMs).toBe(0);
    coordinator.dispose();
  });
});
