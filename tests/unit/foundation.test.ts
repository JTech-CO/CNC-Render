import {
  CNC_RENDER_FOUNDATION_PACKAGES,
  type FoundationPackageName,
} from "@cnc-render/web/foundation";
import { LESSON_ENGINE_PACKAGE_NAME } from "@cnc-render/lesson-engine";
import { RENDERER_PACKAGE_NAME } from "@cnc-render/renderer";
import { SIMULATION_PACKAGE_NAME } from "@cnc-render/simulation";
import { STORAGE_PACKAGE_NAME } from "@cnc-render/storage";
import { UI_PACKAGE_NAME } from "@cnc-render/ui";
import { describe, expect, it } from "vitest";

const expectedPackages = [
  UI_PACKAGE_NAME,
  LESSON_ENGINE_PACKAGE_NAME,
  SIMULATION_PACKAGE_NAME,
  RENDERER_PACKAGE_NAME,
  STORAGE_PACKAGE_NAME,
] as const satisfies readonly FoundationPackageName[];

describe("CNC Render web foundation", () => {
  it("exposes the five composition boundaries in stable order", () => {
    expect(CNC_RENDER_FOUNDATION_PACKAGES).toEqual(expectedPackages);
  });

  it("does not expose duplicate package boundaries", () => {
    expect(new Set(CNC_RENDER_FOUNDATION_PACKAGES).size).toBe(
      CNC_RENDER_FOUNDATION_PACKAGES.length,
    );
  });
});
