import { describe, expect, it } from "vitest";
import { selectSpatialDiagnostics } from "../../app/components/m11-lab-bridge";

describe("M11 bounded spatial diagnostic selection", () => {
  const diagnostics = Array.from({ length: 300 }, (_, index) => ({ id: `runtime-${index}`, positionMm: { xMm: index, yMm: 0, zMm: 370 } }));

  it("keeps the selected diagnostic beyond the scene cap and preserves source coordinates", () => {
    const markers = selectSpatialDiagnostics(diagnostics, "runtime-299");
    expect(markers).toHaveLength(256);
    expect(markers[0]).toEqual(diagnostics[299]);
    expect(markers[0]?.positionMm).toBe(diagnostics[299]?.positionMm);
    expect(new Set(markers.map((item) => item.id)).size).toBe(256);
    expect(selectSpatialDiagnostics([...diagnostics, { id: "later", positionMm: { xMm: 0, yMm: 0, zMm: 370 } }], "runtime-299")).toEqual(markers);
  });

  it("never invents locations for parser/missing diagnostics and bounds normal updates", () => {
    expect(selectSpatialDiagnostics(diagnostics, null)).toEqual(diagnostics.slice(0, 256));
    expect(selectSpatialDiagnostics(diagnostics, "missing")).toEqual(diagnostics.slice(0, 256));
    expect(selectSpatialDiagnostics([{ id: "parser", positionMm: null }], "parser")).toEqual([]);
    expect(selectSpatialDiagnostics(diagnostics, "runtime-10").filter((item) => item.id === "runtime-10")).toHaveLength(1);
  });
});
