import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  createCoordinatorLessonEvidence,
  evaluateLessonStep,
  parseLesson,
  scoreLesson,
} from "@cnc-render/lesson-engine";
import {
  CncRenderWasmRuntime,
  createM7PipelineFixture,
  type M7PipelineFixture,
} from "@cnc-render/simulation";
import { beforeAll, describe, expect, it } from "vitest";

const faceMillingLesson = parseLesson(
  JSON.parse(
    readFileSync(
      new URL("../../content/lessons/ko/face-milling.lesson.json", import.meta.url),
      "utf8",
    ),
  ),
);
const selections = {
  machineId: "machine.vmc-3x-edu",
  stockId: "stock.face-milling-360x200x88",
  materialId: "material.aluminum-6061",
  fixtureId: "fixture.vise-150",
  toolId: "tool.flat-end-mill-20",
  operationId: "operation.face-milling-balanced",
} as const;
const measurements = {
  toolCount: 1,
  maxDeviationMm: 0.2,
  overcutVolumeMm3: 0,
  undercutVolumeMm3: 0,
  cutDepthMm: 2,
} as const;

let wasmBytes: ArrayBuffer;

beforeAll(async () => {
  const bytes = await readFile(
    resolve("public", "wasm", "cnc_render_wasm.wasm"),
  );
  wasmBytes = Uint8Array.from(bytes).buffer;
});

async function run(
  fixture: M7PipelineFixture,
  runId: string,
) {
  const runtime = await CncRenderWasmRuntime.instantiate(wasmBytes);
  let invocation = runtime.initialize(createM7PipelineFixture(fixture, runId));
  while (!invocation.summary.completed && !invocation.summary.stopped) {
    invocation = runtime.step();
  }
  return invocation.summary;
}

function evidenceFrom(
  summary: Awaited<ReturnType<typeof run>>,
) {
  return createCoordinatorLessonEvidence({
    summary,
    selections,
    completedEvents: [
      "setup.completed",
      "measurement.recorded",
      "result.reviewed",
    ],
    metrics: measurements,
  });
}

describe("M10 scoring Worker/WASM parity", () => {
  it("produces identical evidence and score for independent milling replays", async () => {
    const firstSummary = await run(
      "milling",
      "a1000000-0000-4000-8000-000000000001",
    );
    const secondSummary = await run(
      "milling",
      "a1000000-0000-4000-8000-000000000002",
    );
    const first = evidenceFrom(firstSummary);
    const second = evidenceFrom(secondSummary);

    expect(first.finalSemanticHashSha256).toBe(
      second.finalSemanticHashSha256,
    );
    expect(first.evidence).toEqual(second.evidence);
    expect(scoreLesson(faceMillingLesson, first.evidence)).toEqual(
      scoreLesson(faceMillingLesson, second.evidence),
    );
    expect(scoreLesson(faceMillingLesson, first.evidence)).toMatchObject({
      score: 100,
      passed: true,
    });
  });

  it("turns an actual collision stop into the authored failure and score penalty", async () => {
    const collision = evidenceFrom(
      await run(
        "collision-stop",
        "a1000000-0000-4000-8000-000000000003",
      ),
    );

    expect(collision.evidence.metrics.collisionCount).toBe(1);
    expect(collision.evidence.events).not.toContain("simulation.completed");
    expect(
      evaluateLessonStep(
        faceMillingLesson,
        "execute-cut",
        collision.evidence,
      ),
    ).toMatchObject({
      status: "failed",
      matchedFailureRuleId: "execute.collision",
    });
    expect(scoreLesson(faceMillingLesson, collision.evidence)).toMatchObject({
      score: 75,
      passed: false,
    });
  });
});
