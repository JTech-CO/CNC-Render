import { describe, expect, it } from "vitest";
import { aggregateLongTasks, validateLongTaskEvidence } from "../../scripts/benchmark-contract.mjs";

const executions = [
  { kind: "warmup", startMs: 100, endMs: 300 },
  { kind: "realtime", startMs: 400, endMs: 600 },
  { kind: "realtime", startMs: 700, endMs: 900 },
];
function sample(entries: { startTime: number; duration: number }[]) {
  return {
    ...aggregateLongTasks(entries, executions), longTaskEntries: entries, executionWindows: executions,
    repetitions: 2, totalPlaybackLongTasksOver50Ms: entries.filter((entry) => entry.duration > 50).length,
  };
}

describe("M12 per-execution long-task gate", () => {
  it("passes one task in each execution while preserving a cumulative total above one", () => {
    const evidence = sample([{ startTime: 410, duration: 60 }, { startTime: 710, duration: 60 }]);
    expect(evidence.maximumLongTasksPerRun).toBe(1);
    expect(evidence.longTasksOver50MsPerRun).toEqual([1, 1]);
    expect(evidence.totalObservedLongTasksOver50Ms).toBe(2);
    expect(evidence.totalPlaybackLongTasksOver50Ms).toBe(2);
    expect(validateLongTaskEvidence(evidence)).toBe(true);
  });
  it("still fails two tasks in a single execution", () => {
    const evidence = sample([{ startTime: 410, duration: 60 }, { startTime: 510, duration: 60 }]);
    expect(evidence.maximumLongTasksPerRun).toBe(2);
    expect(validateLongTaskEvidence(evidence)).toBe(false);
  });
  it("preserves warmup and applies the same one-task limit to it", () => {
    const evidence = sample([{ startTime: 110, duration: 60 }, { startTime: 210, duration: 60 }]);
    expect(evidence.warmupLongTasksOver50Ms).toBe(2);
    expect(evidence.maximumLongTasksPerRun).toBe(0);
    expect(validateLongTaskEvidence(evidence)).toBe(false);
  });
  it("uses task timestamps independently of observer delivery ordering", () => {
    const entries = [{ startTime: 710, duration: 60 }, { startTime: 110, duration: 60 }, { startTime: 410, duration: 60 }];
    expect(aggregateLongTasks(entries, executions)).toEqual(aggregateLongTasks(entries.toReversed(), executions));
  });
  it("preserves inter-execution tasks and excludes exactly 50 ms", () => {
    const evidence = sample([{ startTime: 300, duration: 60 }, { startTime: 410, duration: 50 }]);
    expect(evidence.betweenExecutionLongTasksOver50Ms).toBe(1);
    expect(evidence.totalObservedLongTasksOver50Ms).toBe(1);
    expect(evidence.warmupLongTasksOver50Ms).toBe(0);
    expect(evidence.longTasksOver50MsPerRun).toEqual([0, 0]);
  });
  it("attributes a task starting before a window if it blocks that execution", () => {
    expect(sample([{ startTime: 90, duration: 60 }]).warmupLongTasksOver50Ms).toBe(1);
    expect(sample([{ startTime: 349, duration: 51 }]).maximumLongTasksPerRun).toBe(0);
  });
  it("attributes a boundary-crossing task once, to the originating execution", () => {
    const evidence = aggregateLongTasks([{ startTime: 290, duration: 60 }], [
      executions[0], { kind: "realtime", startMs: 300, endMs: 600 },
    ]);
    expect(evidence.warmupLongTasksOver50Ms).toBe(1);
    expect(evidence.longTasksOver50MsPerRun).toEqual([0]);
    expect(evidence.totalObservedLongTasksOver50Ms).toBe(1);
  });
  it("does not duplicate final-render tasks across promise-continuation boundaries", () => {
    const evidence = aggregateLongTasks([
      { startTime: 4838, duration: 344 }, { startTime: 5596.7, duration: 363 },
    ], [executions[0],
      { kind: "realtime", startMs: 4469.4, endMs: 5180.3 },
      { kind: "realtime", startMs: 5180.3, endMs: 5957.8 },
      { kind: "realtime", startMs: 5957.8, endMs: 7102.5 },
    ]);
    expect(evidence.longTasksOver50MsPerRun).toEqual([1, 1, 0]);
    expect(evidence.maximumLongTasksPerRun).toBe(1);
    expect(evidence.totalObservedLongTasksOver50Ms).toBe(2);
    expect(evidence.warmupLongTasksOver50Ms + evidence.longTasksOver50MsPerRun.reduce((sum: number, count: number) => sum + count, 0) + evidence.betweenExecutionLongTasksOver50Ms).toBe(evidence.totalObservedLongTasksOver50Ms);
  });
  it("rejects missing, overlapping, misordered or nonfinite evidence", () => {
    expect(() => aggregateLongTasks([], [])).toThrow();
    expect(() => aggregateLongTasks([], [executions[1], executions[0]])).toThrow();
    expect(() => aggregateLongTasks([], [executions[0], { ...executions[1], startMs: 299 }])).toThrow();
    expect(() => aggregateLongTasks([{ startTime: NaN, duration: 60 }], executions)).toThrow();
    expect(() => aggregateLongTasks([{ startTime: 1, duration: Infinity }], executions)).toThrow();
    expect(() => aggregateLongTasks([], [{ ...executions[0], endMs: 100 }, executions[1]])).toThrow();
    expect(() => validateLongTaskEvidence({ maximumLongTasksPerRun: 0 })).toThrow();
  });
  it("rejects altered totals, run counts and per-execution counts", () => {
    const evidence = sample([{ startTime: 410, duration: 60 }]);
    for (const tampered of [
      { totalObservedLongTasksOver50Ms: 0 }, { repetitions: 1 }, { longTasksOver50MsPerRun: [0, 0] },
      { maximumLongTasksPerRun: 0 }, { totalPlaybackLongTasksOver50Ms: -1 }, { longTaskAggregationVersion: 1 },
    ]) expect(() => validateLongTaskEvidence({ ...evidence, ...tampered })).toThrow();
  });
});
