/** Stable marker for the persistence adapter boundary. */
export const STORAGE_PACKAGE_NAME = "@cnc-render/storage" as const;

export type StoragePackageName = typeof STORAGE_PACKAGE_NAME;

export * from "./autosave";
export * from "./bytes";
export * from "./browser-adapters";
export * from "./checkpoint";
export * from "./cloud";
export * from "./errors";
export * from "./migrations";
export * from "./project-container";
export * from "./repository";
export * from "./zip";
