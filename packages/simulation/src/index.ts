/** Stable marker for the renderer- and persistence-agnostic simulation core. */
export const SIMULATION_PACKAGE_NAME = "@cnc-render/simulation" as const;

export type SimulationPackageName = typeof SIMULATION_PACKAGE_NAME;

export * from "./collision";
export * from "./collision-demo";
export * from "./coordinator";
export * from "./coordinator-fixtures";
export * from "./kinematics";
export * from "./material-removal-demo";
export * from "./material-removal-milling";
export * from "./material-removal-turning-demo";
export * from "./material-removal-turning";
export * from "./wasm-runtime";
