/** Stable marker for the renderer- and persistence-agnostic simulation core. */
export const SIMULATION_PACKAGE_NAME = "@cnc-render/simulation" as const;

export type SimulationPackageName = typeof SIMULATION_PACKAGE_NAME;

export * from "./collision";
export * from "./collision-demo";
export * from "./gcode-analysis-client";
export * from "./coordinator";
export * from "./coordinator-fixtures";
export * from "./kinematics";
export * from "./kinematics-5axis";
export * from "./kinematics-5axis-inverse";
export * from "./kinematics-5axis-selection";
export * from "./material-removal-demo";
export * from "./material-removal-milling";
export * from "./milling-target-measurement";
export * from "./material-removal-turning-demo";
export * from "./material-removal-turning";
export * from "./turning-target-measurement";
export * from "./wasm-runtime";
export * from "./result-measurement";
export * from "./result-report-export";
export * from "./result-comparison";
