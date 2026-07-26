/** Stable marker for the renderer- and persistence-agnostic simulation core. */
export const SIMULATION_PACKAGE_NAME = "@cnc-render/simulation" as const;

export type SimulationPackageName = typeof SIMULATION_PACKAGE_NAME;
