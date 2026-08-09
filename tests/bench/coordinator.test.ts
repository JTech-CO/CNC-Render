import {
  SimulationCoordinator,
  createM7PipelineFixture,
} from "@cnc-render/simulation";
import { describe, expect, it } from "vitest";
import { SyntheticCoordinatorWorker } from "../helpers/synthetic-coordinator-worker";

describe("M7 coordinator benchmark", () => {
  it("keeps 2,000 validated Worker updates below the main-thread budget", async () => {
    const worker = new SyntheticCoordinatorWorker();
    const coordinator = new SimulationCoordinator(() => worker);
    const run = createM7PipelineFixture(
      "milling",
      "70000000-0000-4000-8000-000000000321",
    );
    await coordinator.start(run, {
      playbackSpeed: 100,
      executionMode: "fast-forward",
    });

    const startedAt = performance.now();
    for (let sequence = 2; sequence <= 2_001; sequence += 1) {
      worker.emitRunUpdate(run, sequence);
    }
    const durationMs = performance.now() - startedAt;
    const metrics = coordinator.getSnapshot().metrics;

    expect(metrics.workerMessages).toBe(2_002);
    expect(metrics.maximumMainHandlerMs).toBeLessThan(50);
    expect(metrics.generalUiSamples).toBeLessThan(metrics.workerMessages / 10);
    expect(metrics.axisUiSamples).toBeLessThan(metrics.workerMessages / 5);
    expect(durationMs).toBeLessThanOrEqual(3_000);
    coordinator.dispose();
  });
});
