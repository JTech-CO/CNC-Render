import { CoordinatorCommandSchema, CoordinatorEventSchema } from "@cnc-render/contracts";
import { createM7PipelineFixture } from "@cnc-render/simulation";
import { describe, expect, it } from "vitest";
import { createSyntheticCoordinatorSummary } from "../helpers/synthetic-coordinator-worker";

const run = createM7PipelineFixture("milling", "70000000-0000-4000-8000-000000000401");
const envelope = { protocolVersion: 1, messageId: "70000000-0000-4000-8000-000000000402", replyTo: null,
  kind: "command", runId: run.runId, sequence: 1 };

describe("M11 source execution contracts", () => {
  it("requires unique positive bounded breakpoint source lines", () => {
    for (const lines of [[0], [-1], [1.5], [250001], [2, 2]]) {
      expect(CoordinatorCommandSchema.safeParse({ ...envelope, type: "simulation.breakpoints", payload: { lines } }).success).toBe(false);
    }
    expect(CoordinatorCommandSchema.safeParse({ ...envelope, type: "simulation.breakpoints", payload: { lines: [1, 5] } }).success).toBe(true);
    expect(CoordinatorCommandSchema.safeParse({ ...envelope, type: "simulation.step-source-line", payload: {} }).success).toBe(true);
  });

  it("preserves pre-M11 snapshots without injecting hash-changing default fields", () => {
    const summary = createSyntheticCoordinatorSummary(run, 1);
    const event = CoordinatorEventSchema.parse({ ...envelope, kind: "event", type: "simulation.update", payload: { summary, binarySlices: [] } });
    if (event.type !== "simulation.update") throw new Error("Expected update");
    expect(event.payload.summary).toEqual(summary);
    expect("runtimeDiagnostics" in event.payload.summary).toBe(false);
  });

  it("requires a real object, source line and finite location for runtime diagnostics", () => {
    const summary = { ...createSyntheticCoordinatorSummary(run, 1), runtimeDiagnostics: [{
      id: "runtime-" + "a".repeat(64), code: "kinematics.axis.limit-max", origin: "axis-limit", severity: "error",
      message: "Requested X exceeds 500 mm.", sourceLine: 2, objectId: "70000000-0000-4000-8000-000000000001",
      positionMm: { xMm: 501, yMm: 0, zMm: 8 },
    }] };
    const event = { ...envelope, kind: "event", type: "simulation.update", payload: { summary, binarySlices: [] } };
    expect(CoordinatorEventSchema.safeParse(event).success).toBe(true);
    summary.runtimeDiagnostics[0].positionMm.xMm = Number.NaN;
    expect(CoordinatorEventSchema.safeParse(event).success).toBe(false);
  });
});
