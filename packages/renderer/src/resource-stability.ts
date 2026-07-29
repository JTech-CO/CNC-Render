import type { RendererResourceSnapshot } from "./contracts";

export function resourceDelta(
  baseline: RendererResourceSnapshot,
  current: RendererResourceSnapshot,
): RendererResourceSnapshot {
  return {
    geometries: current.geometries - baseline.geometries,
    textures: current.textures - baseline.textures,
    programs: current.programs - baseline.programs,
  };
}

export function resourcesAreStable(
  baseline: RendererResourceSnapshot,
  samples: readonly RendererResourceSnapshot[],
): boolean {
  return samples.every((sample) => {
    const delta = resourceDelta(baseline, sample);
    return (
      delta.geometries <= 0 && delta.textures <= 0 && delta.programs <= 0
    );
  });
}
