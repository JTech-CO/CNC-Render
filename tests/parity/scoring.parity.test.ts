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
  createM7DrillingTarget,
  createM7FaceMillingTarget,
  createM7OdTurningTarget,
  createM7PipelineFixture,
  measureMillingStockAgainstTarget,
  measureTurningStockAgainstTarget,
  type M7PipelineFixture,
  type MillingStockSurfaceDescriptor,
  type TurningProfileSurfaceDescriptor,
  type WasmCoreInvocation,
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

let wasmBytes: ArrayBuffer;

beforeAll(async () => {
  const bytes = await readFile(
    resolve("public", "wasm", "cnc_render_wasm.wasm"),
  );
  wasmBytes = Uint8Array.from(bytes).buffer;
});

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function finite(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError(`${label} must be finite`);
  }
  return value;
}

function positiveInteger(value: unknown, label: string): number {
  const number = finite(value, label);
  if (!Number.isSafeInteger(number) || number <= 0) {
    throw new TypeError(`${label} must be a positive integer`);
  }
  return number;
}

function point(value: unknown, label: string) {
  const candidate = record(value, label);
  return {
    xMm: finite(candidate.xMm, `${label}.xMm`),
    yMm: finite(candidate.yMm, `${label}.yMm`),
    zMm: finite(candidate.zMm, `${label}.zMm`),
  };
}

function millingSurface(
  invocation: WasmCoreInvocation,
): MillingStockSurfaceDescriptor {
  const render = record(invocation.summary.render, "render");
  if (render.renderType !== "milling-full") {
    throw new TypeError("WASM snapshot must contain a complete milling surface");
  }
  const layout = invocation.summary.binaryLayout.find(
    (entry) => entry.binaryKind === "milling.top-z-mm",
  );
  if (!layout) {
    throw new TypeError("WASM snapshot is missing milling.top-z-mm");
  }
  const offset = finite(layout.offset, "milling.top-z-mm.offset");
  const byteLength = finite(
    layout.byteLength,
    "milling.top-z-mm.byteLength",
  );
  if (offset % 4 !== 0 || byteLength % 4 !== 0) {
    throw new TypeError("WASM milling surface is not Float32 aligned");
  }
  const bounds = record(render.boundsMm, "render.boundsMm");
  return {
    boundsMm: {
      minimum: point(bounds.minimum, "render.boundsMm.minimum"),
      maximum: point(bounds.maximum, "render.boundsMm.maximum"),
    },
    columns: positiveInteger(render.columns, "render.columns"),
    rows: positiveInteger(render.rows, "render.rows"),
    resolutionMm: finite(render.resolutionMm, "render.resolutionMm"),
    topZMm: new Float32Array(
      invocation.binary,
      offset,
      byteLength / Float32Array.BYTES_PER_ELEMENT,
    ).slice(),
  };
}

async function run(
  fixture: M7PipelineFixture,
  runId: string,
) {
  const runtime = await CncRenderWasmRuntime.instantiate(wasmBytes);
  let invocation = runtime.initialize(createM7PipelineFixture(fixture, runId));
  while (!invocation.summary.completed && !invocation.summary.stopped) {
    invocation = runtime.step();
  }
  const measurement = measureMillingStockAgainstTarget(
    millingSurface(runtime.snapshot()),
    createM7FaceMillingTarget(),
  );
  return { summary: invocation.summary, measurement };
}

function evidenceFrom(
  result: Awaited<ReturnType<typeof run>>,
) {
  return createCoordinatorLessonEvidence({
    summary: result.summary,
    selections,
    completedEvents: [
      "setup.completed",
      "measurement.recorded",
      "result.reviewed",
    ],
    metrics: {
      toolCount: 1,
      maxDeviationMm: result.measurement.maxDeviationMm,
      overcutVolumeMm3: result.measurement.overcutVolumeMm3,
      undercutVolumeMm3: result.measurement.undercutVolumeMm3,
      cutDepthMm: createM7FaceMillingTarget().commandedCutDepthMm,
    },
  });
}

describe("M10 scoring Worker/WASM parity", () => {
  it("produces identical evidence and score for independent milling replays", async () => {
    const firstRun = await run(
      "milling",
      "a1000000-0000-4000-8000-000000000001",
    );
    const secondRun = await run(
      "milling",
      "a1000000-0000-4000-8000-000000000002",
    );
    const first = evidenceFrom(firstRun);
    const second = evidenceFrom(secondRun);

    expect(first.finalSemanticHashSha256).toBe(
      second.finalSemanticHashSha256,
    );
    expect(firstRun.measurement).toEqual(secondRun.measurement);
    expect(firstRun.measurement).toMatchObject({
      targetId: "m7.face-milling.standard.x",
      maxDeviationMm: 0,
      overcutVolumeMm3: 0,
      undercutVolumeMm3: 0,
      actualRemovedVolumeMm3: 357_888,
      targetRemovedVolumeMm3: 357_888,
    });
    expect(firstRun.summary.removedVolumeMm3).toBe(
      firstRun.measurement.actualRemovedVolumeMm3,
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
    const collisionRun = await run(
        "collision-stop",
        "a1000000-0000-4000-8000-000000000003",
    );
    const collision = evidenceFrom(collisionRun);

    expect(collision.evidence.metrics.collisionCount).toBe(1);
    expect(collision.evidence.events).not.toContain("simulation.completed");
    expect(collisionRun.measurement.undercutVolumeMm3).toBeGreaterThan(0);
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
    const collisionScore = scoreLesson(faceMillingLesson, collision.evidence);
    expect(collisionScore.score).toBeLessThan(75);
    expect(collisionScore.passed).toBe(false);
  });
});

type TurningFixture = Extract<M7PipelineFixture, "drilling" | "turning">;

const odTurningLesson = parseLesson(
  JSON.parse(
    readFileSync(
      new URL("../../content/lessons/ko/od-turning.lesson.json", import.meta.url),
      "utf8",
    ),
  ),
);
const drillingLesson = parseLesson(
  JSON.parse(
    readFileSync(
      new URL("../../content/lessons/ko/drilling.lesson.json", import.meta.url),
      "utf8",
    ),
  ),
);

function turningArray(
  invocation: WasmCoreInvocation,
  binaryKind: "turning.inner-radius-mm" | "turning.outer-radius-mm",
): Float32Array {
  const layout = invocation.summary.binaryLayout.find(
    (entry) => entry.binaryKind === binaryKind,
  );
  if (!layout) {
    throw new TypeError("WASM snapshot is missing " + binaryKind);
  }
  const offset = finite(layout.offset, binaryKind + ".offset");
  const byteLength = finite(layout.byteLength, binaryKind + ".byteLength");
  if (offset % 4 !== 0 || byteLength % 4 !== 0) {
    throw new TypeError(binaryKind + " is not Float32 aligned");
  }
  return new Float32Array(
    invocation.binary,
    offset,
    byteLength / Float32Array.BYTES_PER_ELEMENT,
  ).slice();
}

function turningSurface(
  invocation: WasmCoreInvocation,
): TurningProfileSurfaceDescriptor {
  const render = record(invocation.summary.render, "render");
  if (render.renderType !== "turning-full") {
    throw new TypeError("WASM snapshot must contain a complete turning surface");
  }
  const axisCenterMm = record(render.axisCenterMm, "render.axisCenterMm");
  const axialCells = positiveInteger(render.axialCells, "render.axialCells");
  const innerRadiusMm = turningArray(
    invocation,
    "turning.inner-radius-mm",
  );
  const outerRadiusMm = turningArray(
    invocation,
    "turning.outer-radius-mm",
  );
  if (
    innerRadiusMm.length !== axialCells ||
    outerRadiusMm.length !== axialCells
  ) {
    throw new TypeError("WASM turning surface length does not match axialCells");
  }
  return {
    axisCenterMm: {
      xMm: finite(axisCenterMm.xMm, "render.axisCenterMm.xMm"),
      yMm: finite(axisCenterMm.yMm, "render.axisCenterMm.yMm"),
    },
    minimumZMm: finite(render.minimumZMm, "render.minimumZMm"),
    maximumZMm: finite(render.maximumZMm, "render.maximumZMm"),
    axialCells,
    radialSegments: positiveInteger(
      render.radialSegments,
      "render.radialSegments",
    ),
    resolutionMm: finite(render.resolutionMm, "render.resolutionMm"),
    innerRadiusMm,
    outerRadiusMm,
  };
}

function turningTarget(fixture: TurningFixture) {
  return fixture === "drilling"
    ? createM7DrillingTarget()
    : createM7OdTurningTarget();
}

async function runTurning(fixture: TurningFixture, runId: string) {
  const runtime = await CncRenderWasmRuntime.instantiate(wasmBytes);
  let invocation = runtime.initialize(createM7PipelineFixture(fixture, runId));
  while (!invocation.summary.completed && !invocation.summary.stopped) {
    invocation = runtime.step();
  }
  const target = turningTarget(fixture);
  const measurement = measureTurningStockAgainstTarget(
    turningSurface(runtime.snapshot()),
    target,
  );
  return { summary: invocation.summary, target, measurement };
}

function turningEvidenceFrom(
  result: Awaited<ReturnType<typeof runTurning>>,
  fixture: TurningFixture,
) {
  return createCoordinatorLessonEvidence({
    summary: result.summary,
    selections: {
      machineId: "machine.cnc-lathe-2x-edu",
      stockId: "stock.turning-cylinder-80x120",
      materialId: "material.aluminum-6061",
      fixtureId: "fixture.three-jaw-chuck",
      toolId:
        fixture === "drilling"
          ? "tool.twist-drill-16"
          : "tool.od-turning-insert",
      operationId:
        fixture === "drilling"
          ? "operation.drilling-16x80"
          : "operation.od-turning-balanced",
    },
    completedEvents: [
      "setup.completed",
      "measurement.recorded",
      "result.reviewed",
    ],
    metrics: {
      toolCount: 1,
      maxDeviationMm: result.measurement.maxDeviationMm,
      overcutVolumeMm3: result.measurement.overcutVolumeMm3,
      undercutVolumeMm3: result.measurement.undercutVolumeMm3,
      cutDepthMm: result.target.commandedCutDepthMm,
    },
  });
}

describe.each([
  {
    fixture: "turning" as const,
    lesson: odTurningLesson,
    targetId: "m7.od-turning.balanced",
    diameterMm: 64,
  },
  {
    fixture: "drilling" as const,
    lesson: drillingLesson,
    targetId: "m7.drilling-16x80.balanced",
    diameterMm: 16,
  },
])("M10 $fixture Worker/WASM scoring parity", (fixtureCase) => {
  it("produces deterministic radius-field evidence and a passing score", async () => {
    const firstRun = await runTurning(
      fixtureCase.fixture,
      fixtureCase.fixture === "turning"
        ? "a2000000-0000-4000-8000-000000000001"
        : "a2000000-0000-4000-8000-000000000003",
    );
    const secondRun = await runTurning(
      fixtureCase.fixture,
      fixtureCase.fixture === "turning"
        ? "a2000000-0000-4000-8000-000000000002"
        : "a2000000-0000-4000-8000-000000000004",
    );
    const first = turningEvidenceFrom(firstRun, fixtureCase.fixture);
    const second = turningEvidenceFrom(secondRun, fixtureCase.fixture);

    expect(first.finalSemanticHashSha256).toBe(
      second.finalSemanticHashSha256,
    );
    expect(firstRun.measurement).toEqual(secondRun.measurement);
    expect(firstRun.measurement).toMatchObject({
      targetId: fixtureCase.targetId,
      maxDeviationMm: 0,
      overcutVolumeMm3: 0,
      undercutVolumeMm3: 0,
      feature: {
        actualDiameterMm: fixtureCase.diameterMm,
        targetDiameterMm: fixtureCase.diameterMm,
      },
    });
    if (firstRun.measurement.process === "drilling") {
      expect(firstRun.measurement.feature.actualDepthMm).toBe(80);
      expect(firstRun.measurement.feature.targetDepthMm).toBe(80);
    }
    expect(firstRun.summary.removedVolumeMm3).toBeCloseTo(
      firstRun.measurement.actualRemovedVolumeMm3,
      3,
    );
    expect(first.evidence).toEqual(second.evidence);
    expect(scoreLesson(fixtureCase.lesson, first.evidence)).toEqual(
      scoreLesson(fixtureCase.lesson, second.evidence),
    );
    expect(scoreLesson(fixtureCase.lesson, first.evidence)).toMatchObject({
      score: 100,
      passed: true,
    });
  });
});
