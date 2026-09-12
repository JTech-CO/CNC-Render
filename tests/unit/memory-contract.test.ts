import { describe, expect, it } from "vitest";
import { attributedMemory, emptyBrowserBaseline, memoryComponents } from "../../scripts/memory-contract.mjs";

const sample = (privateBytes: number, gpuReportedBytes: number) => ({ processes: [{ privateBytes }], gpuReportedBytes });
describe("M12 app-attributed memory", () => {
  it("uses the minimum of three blank-browser samples per component", () => {
    expect(emptyBrowserBaseline([sample(300, 30), sample(310, 20), sample(305, 25)])).toEqual({ privateBytes: 300, gpuBytes: 20 });
  });
  it("includes every scoped process, including Worker and GPU processes", () => {
    expect(memoryComponents({ processes: [{ privateBytes: 10 }, { privateBytes: 20 }], gpuReportedBytes: 40 })).toEqual({ privateBytes: 30, gpuBytes: 40 });
  });
  it("does not offset GPU growth by CPU shrinkage or vice versa", () => {
    expect(attributedMemory(sample(90, 60), { privateBytes: 100, gpuBytes: 20 }).attributedBytes).toBe(40);
    expect(attributedMemory(sample(160, 10), { privateBytes: 100, gpuBytes: 20 }).attributedBytes).toBe(60);
  });
  it("subtracts only measured fixed costs without a budget-specific adjustment", () => {
    expect(attributedMemory(sample(900_000_001, 30_000_000), { privateBytes: 300_000_000, gpuBytes: 20_000_000 }).attributedBytes).toBe(610_000_001);
  });
  it("fails closed for missing or invalid baseline/counters", () => {
    expect(() => emptyBrowserBaseline([sample(10, 10)])).toThrow();
    expect(() => memoryComponents({ processes: [], gpuReportedBytes: 1 })).toThrow();
    for (const value of [NaN, Infinity, -1, 1.5]) expect(() => attributedMemory(sample(10, value), { privateBytes: 0, gpuBytes: 0 })).toThrow();
  });
});
