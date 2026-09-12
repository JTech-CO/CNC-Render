import { describe, expect, it } from "vitest";
import { selectResultDisplaySamples, MAX_RESULT_DISPLAY_SAMPLES } from "../../app/components/result-display-sampling";
import { ResultComparisonView } from "../../app/components/result-comparison-view";
import { compareStockResult } from "../../packages/simulation/src/result-comparison";

describe("M11 bounded result display sampling", () => {
  it("preserves the 1125-cell baseline and bounds worst-case milling/turning/aspect ratios", () => {
    const baseline = selectResultDisplaySamples("milling", 45, 25);
    expect(baseline.reduced).toBe(false); expect(Array.from(baseline.indices)).toEqual(Array.from({ length: 1125 }, (_, index) => index));
    for (const [kind, columns, rows] of [["milling", 2048, 2048], ["milling", 1, 4_194_304], ["milling", 4_194_304, 1], ["turning", 4_194_304, 2]] as const) {
      const sampling = selectResultDisplaySamples(kind, columns, rows);
      expect(sampling.displayedSamples).toBeLessThanOrEqual(MAX_RESULT_DISPLAY_SAMPLES);
      expect(new Set(sampling.indices).size).toBe(sampling.displayedSamples);
      expect(sampling.indices[0]).toBe(0); expect(sampling.indices.at(-1)).toBe(columns * rows - 1);
      expect(sampling.reduced).toBe(true);
    }
  });
  it("projects at most 4096 real cells per mode without modifying full-precision statistics", () => {
    const boundsMm = { minimum: { xMm: 0, yMm: 0, zMm: 0 }, maximum: { xMm: 100, yMm: 100, zMm: 10 } };
    const result = compareStockResult({ provenance: { runId: "7a000000-0000-4000-8000-000000000001", fixtureId: "milling", stateHash: "a".repeat(64), stockHash: "b".repeat(64), logicalTimeS: 1,
      outcome: "completed", collisionCount: 0, warningCount: 0, diagnosticCount: 0 },
      surface: { columns: 100, rows: 100, resolutionMm: 1, boundsMm, topZMm: new Float32Array(10_000).fill(9) },
      target: { targetId: "authored-flat", kind: "flat-end-sweep", stockBoundsMm: boundsMm, cutterDiameterMm: 400,
        sweeps: [{ startMm: { xMm: 0, yMm: 0, zMm: 8 }, endMm: { xMm: 100, yMm: 100, zMm: 8 } }] } });
    const original = JSON.stringify(result.report);
    const noop = () => undefined;
    const context = { fillRect: noop, fillText: noop, beginPath: noop, moveTo: noop, lineTo: noop, closePath: noop, fill: noop, stroke: noop, setLineDash: noop };
    const canvas = { width: 900, height: 380, getContext: () => context, getBoundingClientRect: () => ({ left: 0, top: 0, width: 900, height: 380 }) } as unknown as HTMLCanvasElement;
    const view = new ResultComparisonView(); view.setResult(result);
    for (const mode of ["overlay", "split", "heatmap"] as const) {
      view.draw(canvas, mode);
      expect(view.getDisplaySummary()).toMatchObject({ totalSamples: 10_000, displayedSamples: 4096, projectedSamples: 4096, reduced: true });
      expect(JSON.stringify(result.report)).toBe(original);
      const picked = view.pick(canvas, mode === "split" ? 680 : 450, 220);
      expect(picked).not.toBeNull();
      expect(picked?.point).toEqual({ xMm: result.field.coordinatesMm[picked!.index * 3], yMm: result.field.coordinatesMm[picked!.index * 3 + 1], zMm: result.field.coordinatesMm[picked!.index * 3 + 2] });
      expect(picked?.actualMm).toBe(result.field.actualMm[picked!.index]);
      expect(selectResultDisplaySamples("milling", 100, 100).indices).toContain(picked!.index);
    }
    expect(result.report.comparedCells).toBe(10_000); expect(result.report.undercutVolumeMm3).toBe(10_000);
  });
});
