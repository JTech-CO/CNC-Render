import { RENDERER_PACKAGE_NAME } from "@cnc-render/renderer";
import { SIMULATION_PACKAGE_NAME } from "@cnc-render/simulation";
import { STORAGE_PACKAGE_NAME } from "@cnc-render/storage";
import { UI_PACKAGE_NAME } from "@cnc-render/ui";

/**
 * Composition-boundary marker consumed by the root site adapter.
 * Business orchestration is introduced in later milestones.
 */
export const CNC_RENDER_FOUNDATION_PACKAGES = [
  UI_PACKAGE_NAME,
  SIMULATION_PACKAGE_NAME,
  RENDERER_PACKAGE_NAME,
  STORAGE_PACKAGE_NAME,
] as const;

export type FoundationPackageName =
  (typeof CNC_RENDER_FOUNDATION_PACKAGES)[number];
