import { describe, expect, it, vi } from "vitest";
import { detectBrowserRendererCapabilities } from "../../packages/renderer/src/capabilities";

describe("renderer capability probe lifetime", () => {
  it("releases its temporary WebGL context without changing supported backend flags", () => {
    const loseContext = vi.fn();
    const getExtension = vi.fn(() => ({ loseContext }));
    const getContext = vi.fn(() => ({ getExtension }));
    const createElement = vi.fn(() => ({ getContext }));
    const probe = detectBrowserRendererCapabilities({ navigator: { gpu: {} }, crossOriginIsolated: false } as unknown as Window,
      { createElement } as unknown as Document);
    expect(probe.webgpu).toBe(true);
    expect(probe.webgl2).toBe(true);
    expect(getExtension).toHaveBeenCalledWith("WEBGL_lose_context");
    expect(getContext).toHaveBeenCalledWith("webgl2", { failIfMajorPerformanceCaveat: false, powerPreference: "high-performance" });
    expect(loseContext).toHaveBeenCalledTimes(1);
    expect(createElement).toHaveBeenCalledTimes(1);
  });
  it("supports browsers without the optional release extension and rejects missing contexts", () => {
    const windowObject = { navigator: {} } as Window;
    expect(detectBrowserRendererCapabilities(windowObject, { createElement: () => ({ getContext: () => ({ getExtension: () => null }) }) } as unknown as Document).webgl2).toBe(true);
    expect(detectBrowserRendererCapabilities(windowObject, { createElement: () => ({ getContext: () => null }) } as unknown as Document).webgl2).toBe(false);
  });
});
