import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { CoordinatorEventSchema, type CoordinatorCoreSummary } from "@cnc-render/contracts";
import { CncRenderWasmRuntime, createM7PipelineFixture } from "@cnc-render/simulation";
import { describe, expect, it } from "vitest";

const wasmBytes = readFileSync(resolve("public", "wasm", "cnc_render_wasm.wasm"));
const runId = "70000000-0000-4000-8000-000000000405";

function validate(summary: CoordinatorCoreSummary) {
  return CoordinatorEventSchema.parse({ protocolVersion: 1, messageId: crypto.randomUUID(), replyTo: null,
    kind: "event", type: "simulation.update", runId: summary.runId, sequence: 1,
    payload: { summary, binarySlices: [] } });
}

describe("M11 actual WASM source execution parity", () => {
  it("source ticks preserve legacy final hashes while visiting the final control line", async () => {
    const run = createM7PipelineFixture("milling", runId);
    const legacy = await CncRenderWasmRuntime.instantiate(wasmBytes);
    const source = await CncRenderWasmRuntime.instantiate(wasmBytes);
    let canonicalSummary = legacy.initialize(run).summary;
    let sourceSummary = source.initialize(run).summary;
    for (let count = 0; !canonicalSummary.completed && count < 1000; count += 1) canonicalSummary = legacy.step().summary;
    for (let count = 0; !sourceSummary.completed && count < 1000; count += 1) {
      sourceSummary = source.sourceTick().summary;
      validate(sourceSummary);
    }
    expect(sourceSummary.completed).toBe(true);
    expect(sourceSummary.currentSourceLine).toBe(run.source.split("\n").findIndex((line) => line.includes("M30")) + 1);
    expect(sourceSummary.nextSourceLine).toBeNull();
    expect(sourceSummary.finalSemanticHashSha256).toBe(canonicalSummary.finalSemanticHashSha256);
    expect(sourceSummary.stockHashSha256).toBe(canonicalSummary.stockHashSha256);
    expect(sourceSummary.logicalTimeS).toBe(canonicalSummary.logicalTimeS);
  });

  it("serializes native axis diagnostics through the strict TypeScript event contract", async () => {
    const fixture = createM7PipelineFixture("milling", runId);
    if (fixture.process.processType !== "milling") throw new Error("Expected milling");
    const runtime = await CncRenderWasmRuntime.instantiate(wasmBytes);
    runtime.initialize({ ...fixture, source: `G21 G90\nG1 X${fixture.process.axisLimitMm + 1} F600\nM30\n` });
    runtime.stepSourceLine();
    const summary = runtime.stepSourceLine().summary;
    validate(summary);
    expect(summary.stopped).toBe(true);
    expect(summary.runtimeDiagnostics?.[0]).toMatchObject({ origin: "axis-limit", sourceLine: 2,
      code: "kinematics.axis.limit-max", objectId: "70000000-0000-4000-8000-000000000001" });
    expect(summary.removedVolumeMm3).toBe(0);
  });
});
