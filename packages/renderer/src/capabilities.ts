import {
  RENDERER_LIMITS,
  type RendererBackendSelection,
  type RendererCapabilityProbe,
  type RendererPreference,
} from "./contracts";

function supportedWebgl2(documentObject: Document): boolean {
  const canvas = documentObject.createElement("canvas");

  try {
    const context = canvas.getContext("webgl2", {
      failIfMajorPerformanceCaveat: false,
      powerPreference: "high-performance",
    });
    // This canvas is only a capability probe, not the workcell canvas. Release
    // its driver resources immediately, even when WebGPU will render the scene.
    context?.getExtension("WEBGL_lose_context")?.loseContext();
    return context !== null;
  } catch {
    return false;
  }
}

export function detectBrowserRendererCapabilities(
  windowObject: Window = window,
  documentObject: Document = document,
): RendererCapabilityProbe {
  const navigatorWithGpu = windowObject.navigator as Navigator & {
    gpu?: unknown;
  };

  return {
    webgpu: navigatorWithGpu.gpu !== undefined,
    webgl2: supportedWebgl2(documentObject),
    crossOriginIsolated: windowObject.crossOriginIsolated === true,
    maxTextureDimension2d: null,
  };
}

export function selectRendererBackend(
  capabilities: RendererCapabilityProbe,
  requested: RendererPreference = "auto",
): RendererBackendSelection {
  if (
    (requested === "auto" && capabilities.webgpu) ||
    (requested === "webgpu" && capabilities.webgpu)
  ) {
    return {
      mode: "webgpu",
      requested,
      reason: requested === "webgpu" ? "webgpu-forced" : "webgpu-available",
      limits: RENDERER_LIMITS.webgpu,
    };
  }

  if (capabilities.webgl2) {
    return {
      mode: "webgl2",
      requested,
      reason: requested === "webgl2" ? "webgl2-forced" : "webgl2-fallback",
      limits: RENDERER_LIMITS.webgl2,
    };
  }

  return {
    mode: null,
    requested,
    reason: "no-supported-backend",
    limits: [],
  };
}
